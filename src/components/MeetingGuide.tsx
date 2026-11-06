import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useChat } from '../hooks/ChatContext';
import { checkedGuidedCalendar, guidedCalendarMonth, retainedGuidedSelection, shiftGuidedMonth, type GuidedBookingSlot } from '../lib/booking-guide';
import { addCivilDays, madridDateKey } from '../lib/civil-time';
import '../styles/meeting-guide.css';

export default function MeetingGuide({ language, onClose }: { language: 'es' | 'en'; onClose: () => void }) {
  const { requestBooking, bookingAction, isTyping, isDeleting, bookingContextKey } = useChat();
  const english = language === 'en';
  const id = useId();
  const [today, setToday] = useState(() => madridDateKey());
  const lastDate = addCivilDays(today, 180);
  const [month, setMonth] = useState(`${today.slice(0, 7)}-01`);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<GuidedBookingSlot[]>([]);
  const [selected, setSelected] = useState<GuidedBookingSlot | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const lastRefresh = useRef(0);
  const loadedRange = useRef('');
  const disabled = isTyping || isDeleting || !bookingContextKey;
  const firstMonth = `${today.slice(0, 7)}-01`;
  const lastMonth = `${lastDate.slice(0, 7)}-01`;
  const displayedMonth = month < firstMonth ? firstMonth : month > lastMonth ? lastMonth : month;
  const calendar = guidedCalendarMonth(displayedMonth, today, lastDate);
  const byDate = useMemo(() => {
    const grouped = new Map<string, GuidedBookingSlot[]>();
    for (const slot of slots) grouped.set(slot.date, [...(grouped.get(slot.date) || []), slot]);
    return grouped;
  }, [slots]);
  const daySlots = date ? byDate.get(date) || [] : [];
  const locale = english ? 'en-GB' : 'es-ES';
  const dateLabel = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${value}T12:00:00Z`));
  const monthLabel = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${calendar.month}T12:00:00Z`));
  const previousMonth = shiftGuidedMonth(calendar.month, -1);
  const nextMonth = shiftGuidedMonth(calendar.month, 1);

  useEffect(() => {
    const updateDay = () => setToday(madridDateKey());
    const timer = window.setInterval(updateDay, 60000);
    window.addEventListener('focus', updateDay);
    document.addEventListener('visibilitychange', updateDay);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', updateDay); document.removeEventListener('visibilitychange', updateDay); };
  }, []);

  useEffect(() => {
    const revisit = () => {
      if (document.visibilityState !== 'visible' || loading || disabled || bookingAction?.status === 'confirmation_required' || bookingAction?.status === 'confirmed') return;
      const now = Date.now();
      // A tab becoming visible can also receive focus. One visit needs one query.
      if (now - lastRefresh.current < 1000) return;
      lastRefresh.current = now;
      setRefresh(value => value + 1);
    };
    window.addEventListener('focus', revisit);
    document.addEventListener('visibilitychange', revisit);
    return () => { window.removeEventListener('focus', revisit); document.removeEventListener('visibilitychange', revisit); };
  }, [loading, disabled, bookingAction?.status]);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const range = `${calendar.dateFrom}/${calendar.dateTo}`;
    lastRefresh.current = Date.now();
    setLoading(true); setError('');
    if (loadedRange.current !== range) { setSelected(null); setSlots([]); }
    void (async () => {
      try {
        const response = await fetch(`/api/bookings?date_from=${calendar.dateFrom}&date_to=${calendar.dateTo}`, {
          cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        if (!response.ok) throw new Error('availability_unavailable');
        const choices = checkedGuidedCalendar(await response.json(), calendar.dateFrom, calendar.dateTo);
        if (current) {
          loadedRange.current = range;
          setSlots(choices);
          setSelected(previous => retainedGuidedSelection(choices, previous));
          setDate(previous => previous && choices.some(slot => slot.date === previous) ? previous : choices[0]?.date || null);
        }
      } catch {
        if (current) setError(english ? 'We could not load the schedule. Try again or contact the studio.' : 'No se ha podido consultar la agenda. Reintenta o contacta con el estudio.');
      } finally { if (current) setLoading(false); }
    })();
    return () => { current = false; controller.abort(); };
  }, [calendar.dateFrom, calendar.dateTo, refresh, english]);

  useEffect(() => { if (isDeleting) onClose(); }, [isDeleting, onClose]);
  useEffect(() => { if (bookingAction?.status === 'unavailable') setRefresh(value => value + 1); }, [bookingAction]);
  // The server-owned proposal replaces the guide. No form submission creates a booking.
  if (bookingAction?.status === 'confirmation_required' || bookingAction?.status === 'confirmed') return null;
  return <section className="meeting-guide" aria-labelledby={`${id}-title`}>
    <div className="meeting-guide-heading"><div>
      <p className="meeting-guide-eyebrow">AKRASIA / {english ? 'LET’S TALK' : 'HABLEMOS'}</p>
      <h3 id={`${id}-title`}>{english ? 'Your project starts with a conversation.' : 'Tu proyecto empieza con una conversación.'}</h3>
    </div><button type="button" onClick={onClose} className="meeting-guide-close" aria-label={english ? 'Close meeting guide' : 'Cerrar guía de reunión'}>×</button></div>
    <p className="meeting-guide-summary">{english ? 'Let’s explore your idea in a 30-minute video call. Choose an available day and time, leave your email and review your call.' : 'Exploremos tu idea en una videollamada de 30 minutos. Elige un día y una hora disponibles, deja tu email y revisa tu llamada.'}</p>
    <ol className="meeting-guide-steps" aria-label={english ? 'Booking steps' : 'Pasos de la reserva'}>
      <li data-active={!selected}>01 / {english ? 'Choose a time' : 'Elige horario'}</li><li data-active={Boolean(selected)}>02 / {english ? 'Your details' : 'Tus datos'}</li><li>03 / {english ? 'Confirm' : 'Confirma'}</li>
    </ol>
    <form onSubmit={event => {
      event.preventDefault();
      if (!selected || disabled || loading || error || selected.date < today) return;
      void requestBooking({ date: selected.date, time: selected.time, email: email.trim(), name: name.trim() });
    }}>
      <div className="meeting-guide-calendar" role="group" aria-labelledby={`${id}-month`} aria-busy={loading}>
        <div className="meeting-guide-month">
          <button type="button" aria-label={english ? 'Previous month' : 'Mes anterior'} disabled={disabled || previousMonth < firstMonth} onClick={() => { setMonth(previousMonth); setSelected(null); setDate(null); }}><span aria-hidden="true">←</span></button>
          <h4 id={`${id}-month`}>{monthLabel}</h4>
          <button type="button" aria-label={english ? 'Next month' : 'Mes siguiente'} disabled={disabled || nextMonth > lastMonth} onClick={() => { setMonth(nextMonth); setSelected(null); setDate(null); }}><span aria-hidden="true">→</span></button>
        </div>
        <div className="meeting-guide-weekdays" aria-hidden="true">{(english ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['L', 'M', 'X', 'J', 'V', 'S', 'D']).map((day, index) => <span key={index}>{day}</span>)}</div>
        <div className="meeting-guide-days">{calendar.cells.map((day, index) => {
          if (!day) return <span key={`empty-${index}`} aria-hidden="true" />;
          const count = byDate.get(day)?.length || 0;
          return <button key={day} type="button" disabled={disabled || loading || !!error || !count} data-available={count > 0} data-selected={day === date} aria-pressed={day === date} aria-current={day === today ? 'date' : undefined}
            aria-label={`${dateLabel(day)}: ${count ? (english ? `${count} available times` : `${count} horarios disponibles`) : (english ? 'no available times' : 'sin horarios disponibles')}`}
            onClick={() => { setDate(day); setSelected(null); }}>{Number(day.slice(8))}</button>;
        })}</div>
        <p className="meeting-guide-calendar-key"><span aria-hidden="true" />{english ? 'Days with available times' : 'Días con horarios disponibles'}</p>
      </div>
      <p className="meeting-guide-zone">{english ? 'All times in Madrid (Europe/Madrid) · 30-minute video call.' : 'Horario de Madrid (Europe/Madrid) · Videollamada de 30 minutos.'}</p>
      <div className="meeting-guide-status" role="status" aria-live="polite">{loading ? <p>{english ? 'Checking available days and times…' : 'Consultando días y horarios disponibles…'}</p> : error ? <><p>{error}</p><button type="button" className="chat-action" onClick={() => setRefresh(value => value + 1)} disabled={disabled}>{english ? 'Try again' : 'Reintentar'}</button></> : !slots.length ? <p>{nextMonth <= lastMonth ? (english ? 'No available times this month. Check the next month or write to' : 'No hay horarios disponibles este mes. Consulta el siguiente mes o escribe a') : (english ? 'No available times in this period. Write to' : 'No hay horarios disponibles en este periodo. Escribe a')} <a href="mailto:info@akrasia.studio">info@akrasia.studio</a>.</p> : date ? <p className="meeting-guide-date-label">{dateLabel(date)} <span> / {english ? 'Available times' : 'Horarios disponibles'}</span></p> : null}</div>
      {!loading && !error && daySlots.length > 0 && <fieldset disabled={disabled} className="meeting-guide-slots"><legend className="sr-only">{english ? 'Available times' : 'Horarios disponibles'} · {date && dateLabel(date)}</legend>
        {daySlots.map(slot => <label key={`${slot.date}-${slot.time}`} data-selected={selected?.date === slot.date && selected.time === slot.time}>
          <input type="radio" name={`${id}-slot`} value={`${slot.date}-${slot.time}`} checked={selected?.date === slot.date && selected.time === slot.time} onChange={() => setSelected(slot)} required />
          <strong>{slot.time}</strong>
        </label>)}
      </fieldset>}
      {selected && <fieldset className="meeting-guide-contact" disabled={disabled}><legend>{english ? 'Where should we send your invitation?' : '¿Dónde te enviamos la invitación?'}</legend>
        <p className="meeting-guide-selection">{dateLabel(selected.date)} <strong>{selected.time}</strong></p>
        <label htmlFor={`${id}-email`}>Email <input id={`${id}-email`} type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label htmlFor={`${id}-name`}>{english ? 'Name (optional)' : 'Nombre (opcional)'}<input id={`${id}-name`} type="text" autoComplete="name" maxLength={150} value={name} onChange={event => setName(event.target.value)} /></label>
        <button type="submit" className="meeting-guide-submit" disabled={disabled || loading || !!error}>{isTyping ? (english ? 'Preparing…' : 'Preparando…') : (english ? 'Review my video call' : 'Revisar mi videollamada')} <span aria-hidden="true">↗</span></button>
        <p className="meeting-guide-zone">{english ? 'The time is reserved only after you confirm the proposal.' : 'El horario solo queda reservado después de confirmar la propuesta.'}</p>
      </fieldset>}
    </form>
  </section>;
}
