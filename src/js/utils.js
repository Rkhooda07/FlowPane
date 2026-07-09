import { DUE_BLOCKS } from './constants.js';

export function parseMaskedDate(str) {
  // Format: DD/MM/YYYY, HH:MM AM/PM
  const regex = /(\d{2})\/(\d{2})\/(\d{4}),\s(\d{2}):(\d{2})\s(AM|PM)/;
  const match = str.match(regex);
  if (!match) return null;

  let [_, day, month, year, hour, min, period] = match;
  hour = parseInt(hour);
  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;

  const date = new Date(year, month - 1, day, hour, min);
  return isNaN(date.getTime()) ? null : date;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function getDueBlockFromSelection(cursor, selectionEnd = cursor) {
  return DUE_BLOCKS.find(({ start, end }) => cursor >= start && selectionEnd <= end) || null;
}

export function setDueBlockValue(value, block, nextBlockValue) {
  return value.substring(0, block.start) + nextBlockValue + value.substring(block.end);
}

export function formatDueBlockForEditing(block, rawValue) {
  const padded = rawValue.padStart(block.length, '0');
  return padded.slice(-block.length);
}

export function normalizeDueBlockValue(type, rawValue, fullValue) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const currentYear = now.getFullYear();
  const currentHour = now.getHours() % 12 || 12;
  const currentMinute = now.getMinutes();
  const parsedRaw = parseInt(rawValue, 10);

  if (type === 'day') {
    const fullYear = parseInt(fullValue.substring(6, 10), 10);
    const fullMonth = parseInt(fullValue.substring(3, 5), 10);
    const year = Math.max(Number.isNaN(fullYear) ? currentYear : fullYear, currentYear);
    const month = clamp(Number.isNaN(fullMonth) ? currentMonth : fullMonth, 1, 12);
    const maxDay = new Date(year, month, 0).getDate();
    const dayValue = Number.isNaN(parsedRaw) ? currentDay : parsedRaw;
    return String(clamp(dayValue, 1, maxDay)).padStart(2, '0');
  }

  if (type === 'month') {
    const monthValue = Number.isNaN(parsedRaw) ? currentMonth : parsedRaw;
    return String(clamp(monthValue, 1, 12)).padStart(2, '0');
  }

  if (type === 'year') {
    const yearValue = Number.isNaN(parsedRaw) ? currentYear : parsedRaw;
    return String(Math.max(yearValue, currentYear)).padStart(4, '0');
  }

  if (type === 'hour') {
    const hourValue = Number.isNaN(parsedRaw) ? currentHour : parsedRaw;
    return String(clamp(hourValue, 1, 12)).padStart(2, '0');
  }

  if (type === 'minute') {
    const minuteValue = Number.isNaN(parsedRaw) ? currentMinute : parsedRaw;
    return String(clamp(minuteValue, 0, 59)).padStart(2, '0');
  }

  return rawValue;
}

export function normalizeDueInputValue(value, { enforceFuture = false } = {}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const currentHour = now.getHours() % 12 || 12;
  const currentMinute = now.getMinutes();

  const parsedMonth = parseInt(value.substring(3, 5), 10);
  const parsedYear = parseInt(value.substring(6, 10), 10);
  const parsedDay = parseInt(value.substring(0, 2), 10);
  const parsedHour = parseInt(value.substring(12, 14), 10);
  const parsedMinute = parseInt(value.substring(15, 17), 10);

  const month = clamp(Number.isNaN(parsedMonth) ? currentMonth : parsedMonth, 1, 12);
  const year = Math.max(Number.isNaN(parsedYear) ? currentYear : parsedYear, currentYear);
  const maxDay = new Date(year, month, 0).getDate();
  const day = clamp(Number.isNaN(parsedDay) ? currentDay : parsedDay, 1, maxDay);
  const hour = clamp(Number.isNaN(parsedHour) ? currentHour : parsedHour, 1, 12);
  const minute = clamp(Number.isNaN(parsedMinute) ? currentMinute : parsedMinute, 0, 59);
  const period = value.substring(18, 20).toUpperCase() === 'PM' ? 'PM' : 'AM';

  const normalized = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${period}`;
  if (!enforceFuture) return normalized;

  const parsed = parseMaskedDate(normalized);
  if (!parsed || parsed.getTime() <= now.getTime()) {
    const future = new Date(now.getTime() + 60 * 1000);
    return formatDateTimeHuman(future);
  }

  return normalized;
}

export function formatDateTimeHuman(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  let h = date.getHours();
  const min = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const hh = String(h).padStart(2, '0');

  return `${d}/${m}/${y}, ${hh}:${min} ${ampm}`;
}

export function capitalizeFirstLetter(e) {
  const input = e.target;
  const val = input.value;
  // Only auto-capitalize when typing the very first character of an empty field
  if (val && val.length === 1 && val[0] !== val[0].toUpperCase()) {
    input.value = val[0].toUpperCase();
  }
}

export function tokenizeBubbleHTML(fullHTML) {
  const tokens = [];
  for (let i = 0; i < fullHTML.length; i++) {
    if (fullHTML.startsWith('<br>', i)) {
      tokens.push('<br>');
      i += 3;
    } else {
      tokens.push(fullHTML[i]);
    }
  }
  return tokens;
}

export function renderBubbleTokens(tokens, count) {
  return tokens.slice(0, count).join('');
}
