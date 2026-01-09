/**
 * Email Classifier Service
 * Wrapper für das intelligente E-Mail-Klassifizierungssystem
 * Wird im Main Process verwendet und über IPC aufgerufen
 */

let IntelligentEmailClassifier, KATEGORIEN, TAGS;
let classifier = null;
let initError = null;

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

// Einzelne E-Mail klassifizieren
async function classifyEmail(email) {
  try {
    console.log('[CLASSIFIER] Classifying single email:', email.subject);
    const cls = getClassifier();
    const result = await cls.klassifiziere(email);
    console.log('[CLASSIFIER] Result:', result.kategorie, result.confidence);
    return { success: true, classification: result };
  } catch (error) {
    console.error('[CLASSIFIER] Error:', error);
    return { success: false, error: error.message };
  }
}

// Mehrere E-Mails klassifizieren (Batch)
async function classifyEmails(emails) {
  try {
    console.log('[CLASSIFIER] Batch classifying', emails.length, 'emails');
    const cls = getClassifier();
    const results = await cls.klassifiziereBatch(emails);
    console.log('[CLASSIFIER] Batch complete, results:', results.length);
    return { success: true, classifications: results };
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

module.exports = {
  classifyEmail,
  classifyEmails,
  getEssenz,
  correctCategory,
  trackOpened,
  trackReplied,
  trackDeletedUnread,
  addSenderToList,
  setOpenAIKey,
  setMyEmails,
  getStats,
  exportLearningData,
  importLearningData,
  resetLearning,
  getCategories,
  KATEGORIEN,
  TAGS
};
