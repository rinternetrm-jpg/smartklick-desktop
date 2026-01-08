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

  // Create a new event
  async createEvent(eventData) {
    const calendar = this.getCalendar();

    const event = {
      summary: eventData.title,
      description: eventData.description || '',
      start: {
        dateTime: eventData.startTime,
        timeZone: 'Europe/Berlin'
      },
      end: {
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

  // Quick add event using natural language
  async quickAddEvent(text) {
    const calendar = this.getCalendar();

    const response = await calendar.events.quickAdd({
      calendarId: 'primary',
      text: text
    });

    return {
      success: true,
      event: this.formatEvent(response.data)
    };
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
