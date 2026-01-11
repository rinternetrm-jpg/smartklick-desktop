/**
 * Email Classifier Service
 * Wrapper für das intelligente E-Mail-Klassifizierungssystem
 * Wird im Main Process verwendet und über IPC aufgerufen
 */

let IntelligentEmailClassifier, KATEGORIEN, TAGS;
let classifier = null;
let initError = null;

// Store für bereits klassifizierte E-Mails
const classifiedEmailsStore = require('./classifiedEmailsStore');

// Lazy load to catch errors
function loadClassifier() {
  if (initError) {
    throw initError;
  }
  if (!IntelligentEmailClassifier) {
    try {
      const classifierModule = require('./classifier');
      IntelligentEmailClassifier = classifierModule.IntelligentEmailClassifier;
      KATEGORIEN = classifierModule.KATEGORIEN;
      TAGS = classifierModule.TAGS;
      console.log('[CLASSIFIER] Module loaded successfully');
    } catch (error) {
      console.error('[CLASSIFIER] Failed to load module:', error);
      initError = error;
      throw error;
    }
  }
}

function getClassifier() {
  if (!classifier) {
    loadClassifier();
    classifier = new IntelligentEmailClassifier({
      enableGPT: true,
      enableLearning: true
    });
    console.log('[CLASSIFIER] Classifier initialized');
  }
  return classifier;
}

// Store initialisieren
async function initializeStore() {
  try {
    await classifiedEmailsStore.initialize();
    const stats = classifiedEmailsStore.getStats();
    console.log(`[CLASSIFIER] Store initialisiert: ${stats.total} E-Mails gespeichert`);
    return { success: true, stats };
  } catch (error) {
    console.error('[CLASSIFIER] Store init error:', error);
    return { success: false, error: error.message };
  }
}

// Einzelne E-Mail klassifizieren
async function classifyEmail(email, accountId = 'default', skipIfKnown = true) {
  try {
    // Prüfe ob bereits klassifiziert
    if (skipIfKnown && classifiedEmailsStore.initialized) {
      const existing = classifiedEmailsStore.getClassification(email, accountId);
      if (existing) {
        console.log('[CLASSIFIER] Already classified:', email.subject?.substring(0, 30), '→', existing.kategorie);
        return {
          success: true,
          classification: {
            kategorie: existing.kategorie,
            confidence: existing.confidence,
            stufe: existing.stufe,
            cached: true
          },
          cached: true
        };
      }
    }

    console.log('[CLASSIFIER] Classifying single email:', email.subject);
    const cls = getClassifier();
    const result = await cls.klassifiziere(email);
    console.log('[CLASSIFIER] Result:', result.kategorie, result.confidence);

    // Speichere Klassifizierung
    if (classifiedEmailsStore.initialized) {
      classifiedEmailsStore.saveClassification(email, accountId, result);
    }

    return { success: true, classification: result };
  } catch (error) {
    console.error('[CLASSIFIER] Error:', error);
    return { success: false, error: error.message };
  }
}

// Mehrere E-Mails klassifizieren (Batch)
async function classifyEmails(emails, accountId = 'default', skipIfKnown = true) {
  try {
    console.log('[CLASSIFIER] Batch classifying', emails.length, 'emails');

    const results = [];
    let cachedCount = 0;
    let newCount = 0;
    const toClassify = [];
    const toClassifyIndices = [];

    // Erst prüfen welche schon klassifiziert sind
    if (skipIfKnown && classifiedEmailsStore.initialized) {
      for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        const existing = classifiedEmailsStore.getClassification(email, accountId);
        if (existing) {
          results[i] = {
            kategorie: existing.kategorie,
            confidence: existing.confidence,
            stufe: existing.stufe,
            cached: true
          };
          cachedCount++;
        } else {
          toClassify.push(email);
          toClassifyIndices.push(i);
        }
      }
      console.log(`[CLASSIFIER] ${cachedCount} bereits bekannt, ${toClassify.length} neu zu klassifizieren`);
    } else {
      // Alle klassifizieren
      toClassify.push(...emails);
      for (let i = 0; i < emails.length; i++) {
        toClassifyIndices.push(i);
      }
    }

    // Neue E-Mails klassifizieren
    if (toClassify.length > 0) {
      const cls = getClassifier();
      const newResults = await cls.klassifiziereBatch(toClassify);

      // Ergebnisse einfügen und speichern
      for (let j = 0; j < newResults.length; j++) {
        const originalIndex = toClassifyIndices[j];
        const email = toClassify[j];
        const result = newResults[j];

        results[originalIndex] = result;
        newCount++;

        // Speichere Klassifizierung
        if (classifiedEmailsStore.initialized) {
          classifiedEmailsStore.saveClassification(email, accountId, result);
        }
      }
    }

    console.log(`[CLASSIFIER] Batch complete: ${cachedCount} cached, ${newCount} neu klassifiziert`);
    return {
      success: true,
      classifications: results,
      stats: { cached: cachedCount, newlyClassified: newCount, total: emails.length }
    };
  } catch (error) {
    console.error('[CLASSIFIER] Batch error:', error);
    return { success: false, error: error.message };
  }
}

// Essenz-E-Mails extrahieren (nur wichtige)
async function getEssenz(emails) {
  try {
    const cls = getClassifier();
    const classifications = await cls.klassifiziereBatch(emails);
    const essenz = cls.getEssenz(emails, classifications);
    return { success: true, essenz, total: emails.length };
  } catch (error) {
    console.error('[CLASSIFIER] Essenz error:', error);
    return { success: false, error: error.message };
  }
}

// Kategorie manuell korrigieren (für Lernsystem)
function correctCategory(email, oldCategory, newCategory) {
  try {
    const cls = getClassifier();
    cls.korrigiereKategorie(email, oldCategory, newCategory);
    return { success: true };
  } catch (error) {
    console.error('[CLASSIFIER] Correction error:', error);
    return { success: false, error: error.message };
  }
}

// E-Mail geöffnet tracken
function trackOpened(email) {
  try {
    const cls = getClassifier();
    cls.emailGeöffnet(email);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// E-Mail beantwortet tracken
function trackReplied(email) {
  try {
    const cls = getClassifier();
    cls.emailBeantwortet(email);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// E-Mail gelöscht ohne lesen tracken
function trackDeletedUnread(email) {
  try {
    const cls = getClassifier();
    cls.emailGelöschtOhneLesen(email);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Absender zu VIP/Familie/Kunden/Whitelist/Blacklist hinzufügen
function addSenderToList(email, listType) {
  try {
    const cls = getClassifier();
    switch (listType) {
      case 'vip':
        cls.addToVIP(email);
        break;
      case 'family':
        cls.addToFamily(email);
        break;
      case 'customer':
        cls.addToCustomers(email);
        break;
      case 'whitelist':
        cls.addToWhitelist(email);
        break;
      case 'blacklist':
        cls.addToBlacklist(email);
        break;
      default:
        return { success: false, error: 'Unknown list type' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// OpenAI API Key setzen
function setOpenAIKey(apiKey) {
  try {
    const cls = getClassifier();
    cls.setOpenAIKey(apiKey);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Eigene E-Mail-Adressen setzen (für CC-Erkennung)
function setMyEmails(emails) {
  try {
    const cls = getClassifier();
    cls.setMyEmails(emails);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Statistiken abrufen
function getStats() {
  try {
    const cls = getClassifier();
    return { success: true, stats: cls.getStats() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Lerndaten exportieren
function exportLearningData() {
  try {
    const cls = getClassifier();
    return { success: true, data: cls.exportLearningData() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Lerndaten importieren
function importLearningData(data) {
  try {
    const cls = getClassifier();
    cls.importLearningData(data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Lerndaten zurücksetzen
function resetLearning() {
  try {
    const cls = getClassifier();
    cls.resetLearning();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Kategorien und Tags für UI
function getCategories() {
  return { success: true, categories: KATEGORIEN, tags: TAGS };
}

// ============= Store-Funktionen =============

// Prüft ob E-Mail bereits klassifiziert wurde
function isEmailClassified(email, accountId = 'default') {
  if (!classifiedEmailsStore.initialized) return false;
  return classifiedEmailsStore.isClassified(email, accountId);
}

// Holt gespeicherte Klassifizierung
function getStoredClassification(email, accountId = 'default') {
  if (!classifiedEmailsStore.initialized) return null;
  return classifiedEmailsStore.getClassification(email, accountId);
}

// Filtert bereits klassifizierte E-Mails heraus
function filterUnclassifiedEmails(emails, accountId = 'default') {
  if (!classifiedEmailsStore.initialized) return emails;
  return classifiedEmailsStore.filterUnclassified(emails, accountId);
}

// Store-Statistiken
function getStoreStats() {
  if (!classifiedEmailsStore.initialized) {
    return { success: false, error: 'Store nicht initialisiert' };
  }
  return { success: true, stats: classifiedEmailsStore.getStats() };
}

// Alle Klassifizierungen für Account
function getClassificationsForAccount(accountId) {
  if (!classifiedEmailsStore.initialized) return [];
  return classifiedEmailsStore.getClassificationsForAccount(accountId);
}

// Store leeren (Reset)
function clearClassificationStore() {
  classifiedEmailsStore.clearAll();
  return { success: true };
}

// Klassifizierungen für Account löschen
function clearClassificationsForAccount(accountId) {
  classifiedEmailsStore.clearForAccount(accountId);
  return { success: true };
}

// Alte Klassifizierungen aufräumen
function cleanupOldClassifications(daysToKeep = 90) {
  classifiedEmailsStore.cleanupOld(daysToKeep);
  return { success: true };
}

module.exports = {
  // Klassifizierung
  classifyEmail,
  classifyEmails,
  getEssenz,
  correctCategory,
  // Tracking
  trackOpened,
  trackReplied,
  trackDeletedUnread,
  // Listen
  addSenderToList,
  // Konfiguration
  setOpenAIKey,
  setMyEmails,
  // Statistiken
  getStats,
  getCategories,
  // Lerndaten
  exportLearningData,
  importLearningData,
  resetLearning,
  // Store-Funktionen (NEU)
  initializeStore,
  isEmailClassified,
  getStoredClassification,
  filterUnclassifiedEmails,
  getStoreStats,
  getClassificationsForAccount,
  clearClassificationStore,
  clearClassificationsForAccount,
  cleanupOldClassifications,
  // Konstanten
  KATEGORIEN,
  TAGS
};
