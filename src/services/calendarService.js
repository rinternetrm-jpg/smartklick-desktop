// Google Calendar Service for Smartklick Desktop
const { google } = require('googleapis');
const googleAuth = require('./googleAuth');

class CalendarService {
  constructor() {
    this.calendar = null;
  }

  getCalendar() {
    if (!googleAuth.isConnected()) {
      throw new Error('Google nicht verbunden');
    }

    if (!this.calendar) {
      this.calendar = google.calendar({
        version: 'v3',
        auth: googleAuth.getClient()
      });
    }

    return this.calendar;
  }

  // Get today's events
  async getTodayEvents() {
    const calendar = this.getCalendar();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: today.toISOString(),
      timeMax: tomorrow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    return this.formatEvents(response.data.items || []);
  }

  // Get this week's events
  async getWeekEvents() {
    const calendar = this.getCalendar();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: today.toISOString(),
      timeMax: nextWeek.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20
    });

    return this.formatEvents(response.data.items || []);
  }

  // Get upcoming events (next X days)
  async getUpcomingEvents(days = 7) {
    const calendar = this.getCalendar();

    const now = new Date();
    const future = new Date(now);
    future.setDate(future.getDate() + days);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 30
    });

    return this.formatEvents(response.data.items || []);
  }

  // Get this month's events
  async getMonthEvents() {
    const calendar = this.getCalendar();

    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: firstDay.toISOString(),
      timeMax: lastDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100
    });

    return this.formatEvents(response.data.items || []);
  }

  // Get events in date range (for calendar window)
  async getEvents(startDate, endDate) {
    const calendar = this.getCalendar();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startDate,
      timeMax: endDate,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250
    });

    // Return raw events for calendar window (needs more details)
    return response.data.items || [];
  }

  // Create a new event
  async createEvent(eventData) {
    const calendar = this.getCalendar();

    // Support both formats: {title, startTime, endTime} and {summary, start: {dateTime}, end: {dateTime}}
    const event = {
      summary: eventData.summary || eventData.title,
      description: eventData.description || '',
      start: eventData.start ? {
        dateTime: eventData.start.dateTime,
        timeZone: eventData.start.timeZone || 'Europe/Berlin'
      } : {
        dateTime: eventData.startTime,
        timeZone: 'Europe/Berlin'
      },
      end: eventData.end ? {
        dateTime: eventData.end.dateTime,
        timeZone: eventData.end.timeZone || 'Europe/Berlin'
      } : {
        dateTime: eventData.endTime,
        timeZone: 'Europe/Berlin'
      }
    };

    if (eventData.location) {
      event.location = eventData.location;
    }

    if (eventData.attendees) {
      event.attendees = eventData.attendees.map(email => ({ email }));
    }

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });

    return {
      success: true,
      event: this.formatEvent(response.data)
    };
  }

  // Parse German date/time text and return explicit date object
  parseGermanDateTime(text) {
    const now = new Date();
    let targetDate = new Date(now);
    let hour = 12;  // Default to noon
    let minute = 0;
    let title = text;

    const textLower = text.toLowerCase();

    // Extract time: "19 Uhr", "17:30 Uhr", "17:30", "17.30"
    const timeMatch = textLower.match(/(\d{1,2})[:.]?(\d{2})?\s*uhr/i) ||
                      textLower.match(/\b(\d{1,2})[:.](\d{2})\b/);
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      // Remove time from title
      title = title.replace(/\d{1,2}[:.]?\d{0,2}\s*uhr/gi, '').trim();
      title = title.replace(/\b\d{1,2}[:\.]\d{2}\b/gi, '').trim();
    }

    // Check for specific date patterns

    // Pattern: "DD. Monat" or "DD.MM." or "DD.MM.YYYY"
    const germanMonths = {
      'januar': 0, 'februar': 1, 'märz': 2, 'april': 3, 'mai': 4, 'juni': 5,
      'juli': 6, 'august': 7, 'september': 8, 'oktober': 9, 'november': 10, 'dezember': 11
    };

    // DD. Monat pattern (e.g., "30. Januar")
    const monthNameMatch = textLower.match(/(\d{1,2})\.\s*(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)/i);
    if (monthNameMatch) {
      const day = parseInt(monthNameMatch[1], 10);
      const monthName = monthNameMatch[2].toLowerCase();
      const month = germanMonths[monthName];
      targetDate = new Date(now.getFullYear(), month, day);
      // If date is in the past, use next year
      if (targetDate < now) {
        targetDate = new Date(now.getFullYear() + 1, month, day);
      }
      title = title.replace(/\d{1,2}\.\s*(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)/gi, '').trim();
    }

    // DD.MM. or DD.MM.YYYY pattern
    const dateMatch = textLower.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})?/);
    if (dateMatch && !monthNameMatch) {
      const day = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10) - 1;
      const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : now.getFullYear();
      targetDate = new Date(year, month, day);
      // If date is in the past and no year specified, use next year
      if (!dateMatch[3] && targetDate < now) {
        targetDate = new Date(now.getFullYear() + 1, month, day);
      }
      title = title.replace(/\d{1,2}\.\d{1,2}\.(\d{4})?/g, '').trim();
    }

    // Relative days
    if (textLower.includes('heute')) {
      targetDate = new Date(now);
      title = title.replace(/heute/gi, '').trim();
    } else if (textLower.includes('morgen')) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 1);
      title = title.replace(/morgen/gi, '').trim();
    } else if (textLower.includes('übermorgen')) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 2);
      title = title.replace(/übermorgen/gi, '').trim();
    }

    // Weekdays
    const weekdays = {
      'montag': 1, 'dienstag': 2, 'mittwoch': 3, 'donnerstag': 4,
      'freitag': 5, 'samstag': 6, 'sonntag': 0
    };

    for (const [dayName, dayNum] of Object.entries(weekdays)) {
      if (textLower.includes(dayName)) {
        const currentDay = now.getDay();
        let daysToAdd = dayNum - currentDay;
        if (daysToAdd <= 0) {
          daysToAdd += 7;  // Next week
        }
        targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + daysToAdd);
        title = title.replace(new RegExp(dayName, 'gi'), '').trim();
        break;
      }
    }

    // Set the time
    targetDate.setHours(hour, minute, 0, 0);

    // Clean up title: remove "um", "am", commas, extra spaces
    title = title.replace(/\b(um|am|auf|bei)\b/gi, '').trim();
    title = title.replace(/^[,.\s]+|[,.\s]+$/g, '').trim();
    title = title.replace(/\s+/g, ' ').trim();

    // Calculate end time (1 hour later)
    const endDate = new Date(targetDate);
    endDate.setHours(endDate.getHours() + 1);

    console.log('[Calendar] Parsed:', text, '→ title:', title, ', start:', targetDate.toISOString());

    return {
      title: title || 'Termin',
      startDate: targetDate,
      endDate: endDate
    };
  }

  // Quick add event using natural language - now with local parsing
  async quickAddEvent(text) {
    // Parse the German text locally to get explicit date/time
    const parsed = this.parseGermanDateTime(text);

    // Format as ISO strings with timezone
    const startISO = this.toLocalISOString(parsed.startDate);
    const endISO = this.toLocalISOString(parsed.endDate);

    console.log('[Calendar] Creating event:', parsed.title, 'from', startISO, 'to', endISO);

    // Use createEvent with explicit times instead of quickAdd
    return await this.createEvent({
      summary: parsed.title,
      start: { dateTime: startISO },
      end: { dateTime: endISO }
    });
  }

  // Convert Date to ISO string with local timezone offset
  toLocalISOString(date) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const minutes = String(Math.abs(offset) % 60).padStart(2, '0');

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hour}:${min}:${sec}${sign}${hours}:${minutes}`;
  }

  // Delete an event
  async deleteEvent(eventId) {
    const calendar = this.getCalendar();

    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId
    });

    return { success: true };
  }

  // Format events for display
  formatEvents(events) {
    return events.map(event => this.formatEvent(event));
  }

  formatEvent(event) {
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;
    const isAllDay = !event.start?.dateTime;

    const startDate = new Date(start);
    const endDate = new Date(end);

    return {
      id: event.id,
      title: event.summary || 'Ohne Titel',
      description: event.description || '',
      location: event.location || '',
      start: start,
      end: end,
      startFormatted: this.formatDateTime(startDate, isAllDay),
      endFormatted: this.formatDateTime(endDate, isAllDay),
      isAllDay: isAllDay,
      htmlLink: event.htmlLink,
      attendees: (event.attendees || []).map(a => ({
        email: a.email,
        name: a.displayName,
        responseStatus: a.responseStatus
      }))
    };
  }

  formatDateTime(date, isAllDay) {
    const options = isAllDay
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

    return date.toLocaleDateString('de-DE', options);
  }

  // Generate speech response for calendar query
  generateSpeechResponse(events, queryType = 'today') {
    if (events.length === 0) {
      switch (queryType) {
        case 'today':
          return 'Du hast heute keine Termine.';
        case 'week':
          return 'Du hast diese Woche keine Termine.';
        default:
          return 'Keine Termine gefunden.';
      }
    }

    if (queryType === 'today') {
      if (events.length === 1) {
        const e = events[0];
        return `Du hast heute einen Termin: ${e.title} um ${this.formatTimeOnly(e.start)}.`;
      }

      const eventList = events.slice(0, 5).map(e => {
        return `${e.title} um ${this.formatTimeOnly(e.start)}`;
      }).join(', ');

      return `Du hast heute ${events.length} Termine: ${eventList}.`;
    }

    if (queryType === 'week') {
      if (events.length === 1) {
        const e = events[0];
        return `Diese Woche hast du einen Termin: ${e.title} am ${e.startFormatted}.`;
      }

      return `Diese Woche hast du ${events.length} Termine. Der nächste ist ${events[0].title} am ${events[0].startFormatted}.`;
    }

    return `${events.length} Termine gefunden.`;
  }

  formatTimeOnly(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
}

// Singleton instance
const calendarService = new CalendarService();

module.exports = calendarService;
