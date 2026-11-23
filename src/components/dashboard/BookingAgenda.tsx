import { useCallback, useEffect, useId, useRef, useState } from 'react';
import AvailabilityManager, { type AvailabilityOverride, type AvailabilitySlot } from './AvailabilityManager';
import { addCivilDays, civilWeekday, formatCivilDateES, isCivilDate, madridDateKey, madridInstant } from '../../lib/civil-time';
import { availabilityWindowLabel, effectiveAvailabilityWindows } from '../../lib/availability-display';
import { bookingMonthCells, bookingMonthEnd, bookingMonthStart, bookingOrder, loadAdminBookingRange, safeBookingJoinUrl, shiftBookingMonth, upcomingConfirmedBookings, type AdminBooking, type AgendaRequester } from '../../lib/admin-booking-agenda';
import '../../styles/booking-agenda.css';

const STATUS_LABELS: Record<string, string> = { confirmed: 'Confirmada', pending: 'Pendiente', completed: 'Completada', cancelled: 'Cancelada' };
const monthLabel = (date: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
const initialDate = () => {
  const date = new URLSearchParams(window.location.search).get('date');
  const today = madridDateKey();
  return isCivilDate(date) && date >= addCivilDays(today, -366) && date <= addCivilDays(today, 366) ? date : today;
};

function BookingCard({ booking, pending, now, onStatus, onCalendar, onDate }: {
  booking: AdminBooking; pending: boolean; now: number;
  onStatus: (id: string, status: 'cancelled' | 'completed') => void;
  onCalendar: (booking: AdminBooking) => void;
  onDate?: (date: string) => void;
}) {
  const joinUrl = safeBookingJoinUrl(booking.meet_url);
  const start = madridInstant(booking.booked_date, booking.booked_time.slice(0, 5));
  const ongoing = booking.status === 'confirmed' && start !== null && start <= now && start + booking.duration_min * 60000 > now;
  return <article className={`booking-agenda__card booking-agenda__card--${['confirmed', 'pending', 'completed', 'cancelled'].includes(booking.status) ? booking.status : 'unknown'}`}>
    <div className="booking-agenda__card-top">
      <div>
        <p className="booking-agenda__date">{formatCivilDateES(booking.booked_date)}</p>
        <p className="booking-agenda__time">{booking.booked_time.slice(0, 5)} <span>· {booking.duration_min} min · Madrid</span></p>
      </div>
      <span className="booking-agenda__status">{ongoing ? 'En curso' : STATUS_LABELS[booking.status] || 'Estado desconocido'}</span>
    </div>
    <h4>{booking.visitor_name || booking.visitor_email || 'Cliente sin nombre'}</h4>
    <div className="booking-agenda__contact">
      {booking.visitor_email && <span>{booking.visitor_email}</span>}
      {booking.visitor_phone && <span>{booking.visitor_phone}</span>}
    </div>
    {booking.notes && <p className="booking-agenda__notes">{booking.notes}</p>}
    <div className="booking-agenda__card-actions">
      {booking.status !== 'cancelled' && <>
        {joinUrl ? <a href={joinUrl} target="_blank" rel="noopener noreferrer">Unirse a la videollamada ↗</a> : <span className="booking-agenda__muted">Enlace de llamada pendiente</span>}
        <button type="button" disabled={pending} onClick={() => onCalendar(booking)}>Añadir al calendario</button>
      </>}
      {onDate && <button type="button" disabled={pending} onClick={() => onDate(booking.booked_date)}>Ver día</button>}
      {booking.status === 'confirmed' && <button type="button" disabled={pending} onClick={() => onStatus(booking.id, 'completed')}>Completar</button>}
      {['confirmed', 'pending'].includes(booking.status) && <button type="button" disabled={pending} onClick={() => onStatus(booking.id, 'cancelled')} className="booking-agenda__cancel">Cancelar</button>}
    </div>
  </article>;
}

export default function BookingAgenda({ request }: { request: AgendaRequester }) {
  const uid = useId();
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [monthBookings, setMonthBookings] = useState<AdminBooking[]>([]);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [overrides, setOverrides] = useState<AvailabilityOverride[]>([]);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedMonth, setSelectedMonth] = useState(() => bookingMonthStart(initialDate()));
  const [dateToEdit, setDateToEdit] = useState<string | null>(null);
  const [dateEditKey, setDateEditKey] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [monthLoading, setMonthLoading] = useState(true);
  const [error, setError] = useState('');
  const [agendaError, setAgendaError] = useState('');
  const [monthError, setMonthError] = useState('');
  const [notificationStatus, setNotificationStatus] = useState<{ recipient: string | null; state: 'configured' | 'disabled' | 'invalid' | 'unchecked' | 'checking' }>({ recipient: null, state: 'checking' });
  const [pending, setPending] = useState(false);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const lock = useRef(false);
  const refreshLock = useRef(false);
  const agendaSequence = useRef(0);
  const monthSequence = useRef(0);
  const availabilitySequence = useRef(0);
  const notificationSequence = useRef(0);
  const requestRef = useRef(request);
  requestRef.current = request;
  const today = madridDateKey(now);
  const horizon = addCivilDays(today, 180);

  const fetchAvailability = useCallback(async () => {
    const serial = ++availabilitySequence.current;
    const start = madridDateKey();
    const response = await requestRef.current(`/api/dashboard/availability?from=${start}&to=${addCivilDays(start, 180)}`);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data?.availability) || !Array.isArray(data?.overrides)) throw new Error('No se pudo cargar la disponibilidad.');
    if (serial === availabilitySequence.current) { setAvailability(data.availability); setOverrides(data.overrides); }
  }, []);

  const fetchAgenda = useCallback(async () => {
    const serial = ++agendaSequence.current;
    setRefreshing(true);
    try {
      const current = Date.now();
      const start = madridDateKey(current);
      const rows = await loadAdminBookingRange(requestRef.current, start, addCivilDays(start, 180));
      if (serial === agendaSequence.current) { setBookings(rows); setNow(current); setAgendaError(''); }
    } catch (problem) { if (serial === agendaSequence.current) setAgendaError(problem instanceof Error ? problem.message : 'No se pudo cargar la agenda.'); }
    finally { if (serial === agendaSequence.current) { setLoading(false); setRefreshing(false); } }
  }, []);

  const fetchNotificationStatus = useCallback(async () => {
    const serial = ++notificationSequence.current;
    try {
      const response = await requestRef.current('/api/dashboard/bookings/notifications');
      const data = await response.json();
      if (!response.ok || !['configured', 'disabled', 'invalid'].includes(data?.state) || (data.recipient !== null && typeof data.recipient !== 'string')) throw new Error();
      if (serial === notificationSequence.current) setNotificationStatus({ recipient: data.recipient, state: data.state });
    } catch { if (serial === notificationSequence.current) setNotificationStatus({ recipient: null, state: 'unchecked' }); }
  }, []);

  const fetchMonth = useCallback(async () => {
    const serial = ++monthSequence.current;
    setMonthLoading(true);
    try {
      const rows = await loadAdminBookingRange(requestRef.current, selectedMonth, bookingMonthEnd(selectedMonth));
      if (serial === monthSequence.current) { setMonthBookings(rows); setMonthError(''); }
    } catch (problem) { if (serial === monthSequence.current) setMonthError(problem instanceof Error ? problem.message : 'No se pudo cargar el mes.'); }
    finally { if (serial === monthSequence.current) setMonthLoading(false); }
  }, [selectedMonth]);

  const refresh = useCallback(async () => {
    if (lock.current || refreshLock.current) return;
    refreshLock.current = true;
    try {
      const results = await Promise.allSettled([fetchAgenda(), fetchMonth(), fetchAvailability(), fetchNotificationStatus()]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') setError(failed.reason instanceof Error ? failed.reason.message : 'No se pudo actualizar la disponibilidad.');
    } finally { refreshLock.current = false; }
  }, [fetchAgenda, fetchMonth, fetchAvailability, fetchNotificationStatus]);

  useEffect(() => {
    void fetchAgenda();
    void fetchNotificationStatus();
    void fetchAvailability().catch(problem => setError(problem instanceof Error ? problem.message : 'No se pudo cargar la disponibilidad.'));
    return () => { agendaSequence.current++; availabilitySequence.current++; notificationSequence.current++; };
  }, [fetchAgenda, fetchAvailability, fetchNotificationStatus]);
  useEffect(() => { void fetchMonth(); return () => { monthSequence.current++; }; }, [fetchMonth]);
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh]);

  const selectDate = (date: string) => { setSelectedDate(date); setSelectedMonth(bookingMonthStart(date)); };
  const navigateMonth = (delta: number) => { const next = shiftBookingMonth(selectedMonth, delta); setSelectedMonth(next); setSelectedDate(next); };

  const updateStatus = async (id: string, status: 'cancelled' | 'completed') => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try {
      const response = await requestRef.current('/api/dashboard/bookings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
      if (!response.ok) throw new Error('No se pudo guardar el estado de la reserva.');
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== id || rows[0].status !== status) throw new Error('El servidor no confirmó el cambio de la reserva.');
      setBookings(current => current.map(booking => booking.id === id ? { ...booking, ...rows[0] } : booking));
      setMonthBookings(current => current.map(booking => booking.id === id ? { ...booking, ...rows[0] } : booking));
      await Promise.all([fetchAgenda(), fetchMonth()]);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'No se pudo guardar la reserva.'); }
    finally { lock.current = false; setPending(false); }
  };

  const downloadCalendar = async (booking: AdminBooking) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try {
      const response = await requestRef.current(`/api/dashboard/bookings/calendar?id=${encodeURIComponent(booking.id)}`);
      if (!response.ok || !response.headers.get('content-type')?.includes('text/calendar')) throw new Error('No se pudo descargar el evento del calendario.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `akrasia-videollamada-${booking.booked_date}.ics`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'No se pudo descargar el calendario.'); }
    finally { lock.current = false; setPending(false); }
  };

  const upcoming = upcomingConfirmedBookings(bookings, now);
  const next = upcoming[0];
  const nextSevenDays = upcoming.filter(booking => booking.booked_date <= addCivilDays(today, 6)).length;
  const selectedBookings = monthBookings.filter(booking => booking.booked_date === selectedDate).sort(bookingOrder);
  const activeCounts = new Map<string, number>();
  for (const booking of monthBookings) if (['confirmed', 'pending'].includes(booking.status)) activeCounts.set(booking.booked_date, (activeCounts.get(booking.booked_date) || 0) + 1);
  const cells = bookingMonthCells(selectedMonth);
  const windows = effectiveAvailabilityWindows(selectedDate, civilWeekday(selectedDate), availability, overrides);
  const minMonth = bookingMonthStart(addCivilDays(today, -180));
  const maxMonth = bookingMonthStart(addCivilDays(today, 180));
  const displayedUpcoming = showAllUpcoming ? upcoming : upcoming.slice(0, 6);
  const cardActions = { pending, now, onStatus: (id: string, status: 'cancelled' | 'completed') => { void updateStatus(id, status); }, onCalendar: (booking: AdminBooking) => { void downloadCalendar(booking); } };

  return <section className="booking-agenda" aria-label="Agenda de reservas">
    <div className="booking-agenda__header">
      <div><h2>Agenda de videollamadas</h2><p>Reservas en hora de Madrid · Videollamadas de 30 minutos</p></div>
      <button type="button" disabled={refreshing || monthLoading || pending} onClick={() => { void refresh(); }} className="booking-agenda__refresh">{refreshing ? 'Actualizando…' : 'Actualizar agenda'}</button>
    </div>
    <p className={`booking-agenda__notifications booking-agenda__notifications--${notificationStatus.state}`}>
      {notificationStatus.state === 'checking' ? 'Comprobando los avisos por email…' : notificationStatus.state === 'unchecked' ? 'No se ha podido comprobar el estado de los avisos por email.' : notificationStatus.state === 'configured' ? `Avisos por email: envío configurado${notificationStatus.recipient ? ` a ${notificationStatus.recipient}` : ''}.` : `Avisos por email${notificationStatus.recipient ? ` a ${notificationStatus.recipient}` : ''}: pendientes de activar.`}
    </p>
    {error && <p role="alert" className="booking-agenda__error">{error}</p>}
    {agendaError && <p role="alert" className="booking-agenda__error">{agendaError}</p>}
    <div className="booking-agenda__summary" aria-busy={loading}>
      <div className="booking-agenda__next">
        <span>Próxima videollamada</span>
        {loading ? <strong>Cargando reservas…</strong> : next ? <>
          <strong>{formatCivilDateES(next.booked_date)}</strong>
          <p><b>{next.booked_time.slice(0, 5)}</b> · {next.visitor_name || next.visitor_email || 'Cliente sin nombre'}</p>
          <button type="button" disabled={pending} onClick={() => selectDate(next.booked_date)}>Ver la reserva</button>
        </> : <><strong>{agendaError ? 'Agenda sin actualizar' : 'Sin próximas reservas confirmadas'}</strong><p>{agendaError ? 'Actualiza la agenda para comprobar las próximas citas.' : 'Las nuevas citas aparecerán aquí cuando el cliente confirme.'}</p></>}
      </div>
      <div className="booking-agenda__stat"><strong>{loading || agendaError ? '—' : nextSevenDays}</strong><span>Confirmadas en los próximos 7 días</span></div>
      <div className="booking-agenda__stat"><strong>{loading || agendaError ? '—' : upcoming.length}</strong><span>Confirmadas en los próximos 180 días</span></div>
    </div>

    <div className="booking-agenda__calendar-layout">
      <section className="booking-agenda__month" aria-labelledby={`${uid}-month`} aria-busy={monthLoading}>
        <div className="booking-agenda__month-header">
          <button type="button" aria-label="Mes anterior" disabled={pending || selectedMonth <= minMonth} onClick={() => navigateMonth(-1)}>←</button>
          <h3 id={`${uid}-month`}>{monthLabel(selectedMonth)}</h3>
          <button type="button" aria-label="Mes siguiente" disabled={pending || selectedMonth >= maxMonth} onClick={() => navigateMonth(1)}>→</button>
        </div>
        <div className="booking-agenda__weekdays" aria-hidden="true">{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, index) => <span key={index}>{day}</span>)}</div>
        <div className="booking-agenda__month-grid">
          {cells.map((date, index) => date ? <button type="button" key={date} disabled={pending || monthLoading} aria-pressed={date === selectedDate} aria-current={date === today ? 'date' : undefined}
            aria-label={`${formatCivilDateES(date)}${activeCounts.get(date) ? `, ${activeCounts.get(date)} ${activeCounts.get(date) === 1 ? 'reserva' : 'reservas'}` : ', sin reservas activas'}`}
            className={`${activeCounts.has(date) ? 'booking-agenda__day--booked' : ''} ${date === today ? 'booking-agenda__day--today' : ''}`}
            onClick={() => setSelectedDate(date)}><span>{Number(date.slice(-2))}</span>{activeCounts.has(date) && <small>{activeCounts.get(date)} {activeCounts.get(date) === 1 ? 'cita' : 'citas'}</small>}</button> : <span key={`empty-${index}`} aria-hidden="true" />)}
        </div>
        <div className="booking-agenda__month-footer"><span><i /> Día con reservas activas</span><button type="button" disabled={pending} onClick={() => selectDate(today)}>Ir a hoy</button></div>
        {monthLoading && <p role="status" className="booking-agenda__muted">Cargando reservas del mes…</p>}
        {monthError && <p role="alert" className="booking-agenda__error">{monthError}</p>}
      </section>
      <section className="booking-agenda__selected" aria-labelledby={`${uid}-selected`}>
        <div className="booking-agenda__section-title"><h3 id={`${uid}-selected`}>{formatCivilDateES(selectedDate)}</h3><span>{selectedBookings.length} {selectedBookings.length === 1 ? 'reserva' : 'reservas'}</span></div>
        {monthLoading ? <p className="booking-agenda__empty">Cargando citas de este día…</p> : monthError ? <p className="booking-agenda__empty">Actualiza la agenda para comprobar las citas de este día.</p> : selectedBookings.length ? <div className="booking-agenda__cards">{selectedBookings.map(booking => <BookingCard key={booking.id} booking={booking} {...cardActions} />)}</div> : <p className="booking-agenda__empty">No hay reservas para este día. Selecciona un día marcado o consulta las próximas citas.</p>}
        {selectedDate >= today && selectedDate <= horizon && <div className="booking-agenda__day-availability"><span>Franjas abiertas: {windows.length ? windows.map(availabilityWindowLabel).join(' · ') : 'sin horario disponible'}</span><button type="button" disabled={pending || loading} onClick={() => { setDateToEdit(selectedDate); setDateEditKey(key => key + 1); }}>Ajustar disponibilidad del día</button></div>}
      </section>
    </div>

    <section className="booking-agenda__upcoming" aria-labelledby={`${uid}-upcoming`}>
      <div className="booking-agenda__section-title"><h3 id={`${uid}-upcoming`}>Próximas reservas confirmadas</h3><span>Hasta el {formatCivilDateES(horizon)}</span></div>
      <p className="booking-agenda__muted">Estas citas aparecen aunque estés viendo otro mes. En Jitsi Meet, entra con tu cuenta y abre la sala a la hora de la cita.</p>
      {loading ? <p className="booking-agenda__empty">Cargando próximas reservas…</p> : displayedUpcoming.length ? <>
        <div className="booking-agenda__upcoming-grid">{displayedUpcoming.map(booking => <BookingCard key={booking.id} booking={booking} {...cardActions} onDate={selectDate} />)}</div>
        {upcoming.length > 6 && <button type="button" disabled={pending} onClick={() => setShowAllUpcoming(current => !current)}>{showAllUpcoming ? 'Mostrar las primeras 6' : `Ver las ${upcoming.length} próximas reservas`}</button>}
      </> : <p className="booking-agenda__empty">{agendaError ? 'No se pudo comprobar la agenda. Pulsa Actualizar agenda para reintentar.' : 'Todavía no hay reservas confirmadas en los próximos 180 días.'}</p>}
    </section>

    <AvailabilityManager availability={availability} overrides={overrides} dateToEdit={dateToEdit} dateEditKey={dateEditKey} request={request}
      onChange={fetchAvailability} disabled={pending || loading} onPendingChange={busy => { lock.current = busy; setPending(busy); }} />
  </section>;
}
