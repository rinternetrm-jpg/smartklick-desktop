// Calendar App JavaScript
// Smartklick Desktop - Google Calendar Integration

const { ipcRenderer, shell } = require('electron');

class CalendarApp {
  constructor() {
    this.currentDate = new Date();
    this.currentView = 'week';
    this.events = [];
    this.selectedEvent = null;

    this.init();
  }

  async init() {
    this.bindEvents();
    this.renderMiniCalendar();
    await this.loadEvents();
    this.renderCurrentView();
    this.updateDateLabel();
    this.hideLoading();
  }

  bindEvents() {
    // Navigation
    document.getElementById('prevBtn').addEventListener('click', () => this.navigate(-1));
    document.getElementById('nextBtn').addEventListener('click', () => this.navigate(1));
    document.getElementById('todayBtn').addEventListener('click', () => this.goToToday());

    // View tabs
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchView(e.target.dataset.view));
    });

    // Refresh
    document.getElementById('refreshBtn').addEventListener('click', () => this.refresh());

    // Add event
    document.getElementById('addEventBtn').addEventListener('click', () => this.openGoogleCalendar());

    // Modal
    document.getElementById('closeModal').addEventListener('click', () => this.closeModal());
    document.getElementById('eventModal').addEventListener('click', (e) => {
      if (e.target.id === 'eventModal') this.closeModal();
    });
    document.getElementById('openInGoogle').addEventListener('click', () => this.openEventInGoogle());
  }

  async loadEvents() {
    try {
      // Load events for current month +/- 1 month
      const startDate = new Date(this.currentDate);
      startDate.setMonth(startDate.getMonth() - 1);
      startDate.setDate(1);

      const endDate = new Date(this.currentDate);
      endDate.setMonth(endDate.getMonth() + 2);
      endDate.setDate(0);

      this.events = await ipcRenderer.invoke(
        'calendar:getEvents',
        startDate.toISOString(),
        endDate.toISOString()
      );

      this.renderUpcomingEvents();
    } catch (err) {
      console.error('Error loading events:', err);
      this.events = [];
    }
  }

  navigate(direction) {
    switch (this.currentView) {
      case 'day':
        this.currentDate.setDate(this.currentDate.getDate() + direction);
        break;
      case 'week':
        this.currentDate.setDate(this.currentDate.getDate() + (direction * 7));
        break;
      case 'month':
        this.currentDate.setMonth(this.currentDate.getMonth() + direction);
        break;
    }
    this.renderCurrentView();
    this.renderMiniCalendar();
    this.updateDateLabel();
  }

  goToToday() {
    this.currentDate = new Date();
    this.renderCurrentView();
    this.renderMiniCalendar();
    this.updateDateLabel();
  }

  switchView(view) {
    this.currentView = view;

    // Update active tab
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Hide all views
    document.querySelectorAll('.calendar-view').forEach(v => v.classList.add('hidden'));

    // Show selected view
    document.getElementById(`${view}View`).classList.remove('hidden');

    this.renderCurrentView();
    this.updateDateLabel();
  }

  renderCurrentView() {
    switch (this.currentView) {
      case 'day':
        this.renderDayView();
        break;
      case 'week':
        this.renderWeekView();
        break;
      case 'month':
        this.renderMonthView();
        break;
    }
  }

  updateDateLabel() {
    const label = document.getElementById('currentDateLabel');
    const months = ['Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni',
                    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

    switch (this.currentView) {
      case 'day':
        label.textContent = this.formatDate(this.currentDate, 'full');
        break;
      case 'week':
        const weekStart = this.getWeekStart(this.currentDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        if (weekStart.getMonth() === weekEnd.getMonth()) {
          label.textContent = `${weekStart.getDate()}. - ${weekEnd.getDate()}. ${months[weekStart.getMonth()]} ${weekStart.getFullYear()}`;
        } else {
          label.textContent = `${weekStart.getDate()}. ${months[weekStart.getMonth()]} - ${weekEnd.getDate()}. ${months[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;
        }
        break;
      case 'month':
        label.textContent = `${months[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`;
        break;
    }
  }

  // Day View
  renderDayView() {
    const dayGrid = document.getElementById('dayGrid');
    const dayDate = document.getElementById('dayViewDate');

    dayDate.textContent = this.formatDate(this.currentDate, 'full');

    // Create time slots
    let html = '<div class="time-column">';
    for (let hour = 0; hour < 24; hour++) {
      html += `<div class="time-slot-label">${hour.toString().padStart(2, '0')}:00</div>`;
    }
    html += '</div>';

    html += '<div class="day-column">';
    for (let hour = 0; hour < 24; hour++) {
      html += `<div class="time-slot" data-hour="${hour}"></div>`;
    }

    // Add events
    const dayEvents = this.getEventsForDate(this.currentDate);
    dayEvents.forEach(event => {
      const eventHtml = this.createEventElement(event, 'day');
      html += eventHtml;
    });

    html += '</div>';
    dayGrid.innerHTML = html;

    // Scroll to current time
    this.scrollToCurrentTime(dayGrid);
  }

  // Week View
  renderWeekView() {
    const weekHeader = document.getElementById('weekHeader');
    const weekGrid = document.getElementById('weekGrid');
    const weekStart = this.getWeekStart(this.currentDate);
    const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const today = new Date();

    // Render header
    let headerHtml = '<div class="time-column-header"></div>';
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      const isToday = this.isSameDay(date, today);
      headerHtml += `
        <div class="day-header-cell ${isToday ? 'today' : ''}" data-date="${date.toISOString()}">
          <span class="day-name">${days[i]}</span>
          <span class="day-number ${isToday ? 'today-number' : ''}">${date.getDate()}</span>
        </div>
      `;
    }
    weekHeader.innerHTML = headerHtml;

    // Render grid
    let gridHtml = '<div class="time-column">';
    for (let hour = 0; hour < 24; hour++) {
      gridHtml += `<div class="time-slot-label">${hour.toString().padStart(2, '0')}:00</div>`;
    }
    gridHtml += '</div>';

    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      const isToday = this.isSameDay(date, today);

      gridHtml += `<div class="week-day-column ${isToday ? 'today-column' : ''}" data-date="${date.toISOString()}">`;

      for (let hour = 0; hour < 24; hour++) {
        gridHtml += `<div class="time-slot" data-hour="${hour}"></div>`;
      }

      // Add events for this day
      const dayEvents = this.getEventsForDate(date);
      dayEvents.forEach(event => {
        gridHtml += this.createEventElement(event, 'week');
      });

      gridHtml += '</div>';
    }

    weekGrid.innerHTML = gridHtml;

    // Scroll to current time
    this.scrollToCurrentTime(weekGrid);
  }

  // Month View
  renderMonthView() {
    const monthGrid = document.getElementById('monthGrid');
    const firstDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
    const lastDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);
    const today = new Date();

    // Get the Monday of the first week
    let startDate = new Date(firstDay);
    const dayOfWeek = startDate.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate.setDate(startDate.getDate() + diff);

    let html = '';
    let currentDate = new Date(startDate);

    // 6 weeks to cover all cases
    for (let week = 0; week < 6; week++) {
      for (let day = 0; day < 7; day++) {
        const isCurrentMonth = currentDate.getMonth() === this.currentDate.getMonth();
        const isToday = this.isSameDay(currentDate, today);
        const dayEvents = this.getEventsForDate(currentDate);

        html += `
          <div class="month-day ${isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''}"
               data-date="${currentDate.toISOString()}">
            <span class="month-day-number ${isToday ? 'today-number' : ''}">${currentDate.getDate()}</span>
            <div class="month-day-events">
              ${dayEvents.slice(0, 3).map(e => `
                <div class="month-event" style="background: ${this.getEventColor(e)};"
                     onclick="calendarApp.showEventDetail('${e.id}')">
                  ${this.formatTime(new Date(e.start.dateTime || e.start.date))} ${e.summary || 'Kein Titel'}
                </div>
              `).join('')}
              ${dayEvents.length > 3 ? `<div class="more-events">+${dayEvents.length - 3} weitere</div>` : ''}
            </div>
          </div>
        `;

        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    monthGrid.innerHTML = html;

    // Add click handlers for day cells
    monthGrid.querySelectorAll('.month-day').forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (!e.target.classList.contains('month-event')) {
          const date = new Date(cell.dataset.date);
          this.currentDate = date;
          this.switchView('day');
        }
      });
    });
  }

  // Mini Calendar
  renderMiniCalendar() {
    const miniCalendar = document.getElementById('miniCalendar');
    const months = ['Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni',
                    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date();

    let startDate = new Date(firstDay);
    const dayOfWeek = startDate.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate.setDate(startDate.getDate() + diff);

    let html = `
      <div class="mini-calendar-header">
        <button class="mini-nav" onclick="calendarApp.miniNavigate(-1)">&lt;</button>
        <span>${months[month]} ${year}</span>
        <button class="mini-nav" onclick="calendarApp.miniNavigate(1)">&gt;</button>
      </div>
      <div class="mini-calendar-days">
        ${days.map(d => `<span class="mini-day-name">${d}</span>`).join('')}
      </div>
      <div class="mini-calendar-grid">
    `;

    let currentDate = new Date(startDate);
    for (let i = 0; i < 42; i++) {
      const isCurrentMonth = currentDate.getMonth() === month;
      const isToday = this.isSameDay(currentDate, today);
      const isSelected = this.isSameDay(currentDate, this.currentDate);
      const hasEvents = this.getEventsForDate(currentDate).length > 0;

      html += `
        <div class="mini-day ${isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}"
             onclick="calendarApp.selectDate('${currentDate.toISOString()}')">
          ${currentDate.getDate()}
        </div>
      `;

      currentDate.setDate(currentDate.getDate() + 1);
    }

    html += '</div>';
    miniCalendar.innerHTML = html;
  }

  miniNavigate(direction) {
    this.currentDate.setMonth(this.currentDate.getMonth() + direction);
    this.renderMiniCalendar();
    this.loadEvents().then(() => {
      this.renderCurrentView();
      this.updateDateLabel();
    });
  }

  selectDate(dateStr) {
    this.currentDate = new Date(dateStr);
    this.renderMiniCalendar();
    this.renderCurrentView();
    this.updateDateLabel();
  }

  // Upcoming Events
  renderUpcomingEvents() {
    const container = document.getElementById('upcomingEvents');
    const now = new Date();

    const upcoming = this.events
      .filter(e => {
        const start = new Date(e.start.dateTime || e.start.date);
        return start >= now;
      })
      .sort((a, b) => {
        const aStart = new Date(a.start.dateTime || a.start.date);
        const bStart = new Date(b.start.dateTime || b.start.date);
        return aStart - bStart;
      })
      .slice(0, 5);

    if (upcoming.length === 0) {
      container.innerHTML = '<div class="no-events">Keine kommenden Termine</div>';
      return;
    }

    container.innerHTML = upcoming.map(event => {
      const start = new Date(event.start.dateTime || event.start.date);
      const isAllDay = !event.start.dateTime;

      return `
        <div class="upcoming-event" onclick="calendarApp.showEventDetail('${event.id}')">
          <div class="upcoming-event-color" style="background: ${this.getEventColor(event)};"></div>
          <div class="upcoming-event-info">
            <div class="upcoming-event-title">${event.summary || 'Kein Titel'}</div>
            <div class="upcoming-event-time">
              ${this.formatDate(start, 'short')} ${isAllDay ? 'Ganztaegig' : this.formatTime(start)}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Event Element
  createEventElement(event, viewType) {
    const start = new Date(event.start.dateTime || event.start.date);
    const end = new Date(event.end.dateTime || event.end.date);
    const isAllDay = !event.start.dateTime;

    if (isAllDay) {
      return `
        <div class="event-block all-day" style="background: ${this.getEventColor(event)};"
             onclick="calendarApp.showEventDetail('${event.id}')">
          ${event.summary || 'Kein Titel'}
        </div>
      `;
    }

    const startHour = start.getHours() + start.getMinutes() / 60;
    const duration = (end - start) / (1000 * 60 * 60);
    const top = startHour * 60; // 60px per hour
    const height = Math.max(duration * 60, 20);

    return `
      <div class="event-block"
           style="top: ${top}px; height: ${height}px; background: ${this.getEventColor(event)};"
           onclick="calendarApp.showEventDetail('${event.id}')">
        <div class="event-time">${this.formatTime(start)}</div>
        <div class="event-title">${event.summary || 'Kein Titel'}</div>
      </div>
    `;
  }

  // Modal
  showEventDetail(eventId) {
    this.selectedEvent = this.events.find(e => e.id === eventId);
    if (!this.selectedEvent) return;

    const modal = document.getElementById('eventModal');
    const start = new Date(this.selectedEvent.start.dateTime || this.selectedEvent.start.date);
    const end = new Date(this.selectedEvent.end.dateTime || this.selectedEvent.end.date);
    const isAllDay = !this.selectedEvent.start.dateTime;

    document.getElementById('modalTitle').textContent = this.selectedEvent.summary || 'Kein Titel';

    if (isAllDay) {
      document.getElementById('modalTime').textContent = `${this.formatDate(start, 'full')} - Ganztaegig`;
    } else {
      document.getElementById('modalTime').textContent =
        `${this.formatDate(start, 'full')} ${this.formatTime(start)} - ${this.formatTime(end)}`;
    }

    document.getElementById('modalDescription').textContent = this.selectedEvent.description || '';
    document.getElementById('modalLocation').textContent = this.selectedEvent.location || '';

    modal.classList.remove('hidden');
  }

  closeModal() {
    document.getElementById('eventModal').classList.add('hidden');
    this.selectedEvent = null;
  }

  openEventInGoogle() {
    if (this.selectedEvent?.htmlLink) {
      shell.openExternal(this.selectedEvent.htmlLink);
    }
  }

  openGoogleCalendar() {
    shell.openExternal('https://calendar.google.com');
  }

  // Helpers
  getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday is first day
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  isSameDay(date1, date2) {
    return date1.getDate() === date2.getDate() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getFullYear() === date2.getFullYear();
  }

  getEventsForDate(date) {
    return this.events.filter(event => {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      return this.isSameDay(eventStart, date);
    });
  }

  formatDate(date, format) {
    const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const months = ['Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni',
                    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

    if (format === 'full') {
      return `${days[date.getDay()]}, ${date.getDate()}. ${months[date.getMonth()]} ${date.getFullYear()}`;
    } else if (format === 'short') {
      return `${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, '0')}.`;
    }
    return date.toLocaleDateString('de-DE');
  }

  formatTime(date) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }

  getEventColor(event) {
    // Google Calendar colors mapping
    const colors = {
      '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
      '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161',
      '9': '#3f51b5', '10': '#0b8043', '11': '#d50000'
    };
    return colors[event.colorId] || '#14b8a6';
  }

  scrollToCurrentTime(container) {
    const now = new Date();
    const scrollTop = (now.getHours() - 1) * 60;
    setTimeout(() => {
      container.scrollTop = Math.max(0, scrollTop);
    }, 100);
  }

  hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }

  async refresh() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
    await this.loadEvents();
    this.renderCurrentView();
    this.renderMiniCalendar();
    this.hideLoading();
  }
}

// Initialize app
let calendarApp;
document.addEventListener('DOMContentLoaded', () => {
  calendarApp = new CalendarApp();
});
