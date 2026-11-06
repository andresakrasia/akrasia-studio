import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { civilWeekday, formatCivilDateES, isCivilDate, isCivilTime, madridDateKey } from '../../lib/civil-time';
import '../../styles/availability-manager.css';

export interface AvailabilitySlot {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface AvailabilityOverride {
  id: string;
  override_date: string;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean;
  note?: string | null;
}

interface Props {
  availability: AvailabilitySlot[];
  overrides: AvailabilityOverride[];
  dateToEdit?: string | null;
  dateEditKey?: number;
  onChange: () => Promise<void>;
  onPendingChange?: (pending: boolean) => void;
  request: (endpoint: string, options?: RequestInit) => Promise<Response>;
  disabled?: boolean;
}

type EditorTab = 'weekly' | 'dates';
type DateAction = 'open' | 'block' | 'closed';
type WeeklyDraft = { id?: string; day_of_week: number; start_time: string; end_time: string; is_active: boolean };
type DateDraft = { id?: string; date: string; action: DateAction; start: string; end: string; note: string; wholeDayOpening: boolean };
type DateRulesState = { date: string; rows: AvailabilityOverride[] | null; loading: boolean; error: string };
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const time = (value: string) => value.slice(0, 5);
const makeDateDraft = (date: string): DateDraft => ({ date, action: 'open', start: '10:00', end: '14:00', note: '', wholeDayOpening: false });

function dateRuleLabel(rule: AvailabilityOverride): string {
  if (!rule.start_time || !rule.end_time) return rule.is_available ? 'Todo el día abierto' : 'Todo el día cerrado';
  return `${rule.is_available ? 'Horas extra' : 'Bloqueado'} · ${time(rule.start_time)}–${time(rule.end_time)}`;
}

/** Admin edits stay separate from already-confirmed appointment actions. */
export default function AvailabilityManager({ availability, overrides, dateToEdit, dateEditKey, onChange, onPendingChange, request, disabled = false }: Props) {
  const uid = useId();
  const [tab, setTab] = useState<EditorTab>('weekly');
  const [weeklyDraft, setWeeklyDraft] = useState<WeeklyDraft | null>(null);
  const [dateDraft, setDateDraft] = useState<DateDraft>(() => makeDateDraft(isCivilDate(dateToEdit) ? dateToEdit : madridDateKey()));
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dateRules, setDateRules] = useState<DateRulesState>({ date: '', rows: null, loading: false, error: '' });
  const lock = useRef(false);
  const dateSequence = useRef(0);
  const requestRef = useRef(request);
  requestRef.current = request;
  const editorRef = useRef<HTMLDivElement>(null);
  const weeklyTabRef = useRef<HTMLButtonElement>(null);
  const datesTabRef = useRef<HTMLButtonElement>(null);
  const busy = !!pending || disabled;

  const loadDateRules = useCallback(async (date: string): Promise<boolean> => {
    const serial = ++dateSequence.current;
    if (!isCivilDate(date)) { setDateRules({ date, rows: null, loading: false, error: '' }); return false; }
    setDateRules({ date, rows: null, loading: true, error: '' });
    try {
      const response = await requestRef.current(`/api/dashboard/availability?from=${date}&to=${date}`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data?.availability) || !Array.isArray(data?.overrides) || data.overrides.some((rule: AvailabilityOverride) => rule.override_date !== date)) throw new Error('No se pudo comprobar la disponibilidad de esa fecha.');
      if (serial !== dateSequence.current) return false;
      setDateRules({ date, rows: data.overrides, loading: false, error: '' });
      return true;
    } catch (problem) {
      if (serial !== dateSequence.current) return false;
      setDateRules({ date, rows: null, loading: false, error: problem instanceof Error ? problem.message : 'No se pudo comprobar la disponibilidad de esa fecha.' });
      return false;
    }
  }, []);

  useEffect(() => {
    if (tab === 'dates') void loadDateRules(dateDraft.date);
    return () => { dateSequence.current++; };
  }, [tab, dateDraft.date, loadDateRules]);

  useEffect(() => {
    if (!isCivilDate(dateToEdit)) return;
    setTab('dates');
    setDateDraft(makeDateDraft(dateToEdit));
    setError('');
    setNotice('');
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [dateToEdit, dateEditKey]);

  const clearMessages = () => { setError(''); setNotice(''); };
  const selectTab = (next: EditorTab) => { if (!busy) { setTab(next); clearMessages(); } };
  const keyboardTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: EditorTab = event.key === 'Home' ? 'weekly' : event.key === 'End' ? 'dates' : tab === 'weekly' ? 'dates' : 'weekly';
    selectTab(next);
    (next === 'weekly' ? weeklyTabRef : datesTabRef).current?.focus();
  };

  const mutate = async (key: string, method: 'POST' | 'PATCH' | 'DELETE', payload: Record<string, unknown>, message: string, afterSave?: () => void) => {
    if (busy || lock.current) return;
    lock.current = true;
    setPending(key);
    clearMessages();
    let saved = false;
    try {
      onPendingChange?.(true);
      const response = await request('/api/dashboard/availability', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'No se pudo guardar la disponibilidad.');
      if (method === 'DELETE' ? result?.deleted !== true : !Array.isArray(result) || result.length !== 1 || typeof result[0]?.id !== 'string') {
        throw new Error('No se ha podido comprobar el cambio. Recarga la agenda antes de intentarlo de nuevo.');
      }
      saved = true;
      afterSave?.();
      await onChange();
      if (payload.kind === 'override' && tab === 'dates' && !await loadDateRules(dateDraft.date)) throw new Error('No se pudo actualizar esa fecha.');
      setNotice(message);
    } catch (problem) {
      setError(saved ? 'El cambio se guardó, pero no se pudo actualizar la agenda. Recarga el panel para verlo.' : problem instanceof Error ? problem.message : 'No se pudo guardar la disponibilidad.');
    } finally {
      lock.current = false;
      setPending('');
      onPendingChange?.(false);
    }
  };

  const validateRange = (start: string, end: string): boolean => {
    if (!isCivilTime(start) || !isCivilTime(end) || start >= end) {
      setError('La hora de fin debe ser posterior a la de inicio. Para horarios que pasan de medianoche, añade un tramo en cada día.');
      return false;
    }
    return true;
  };
  const validateOpening = (start: string, end: string): boolean => {
    if (!validateRange(start, end)) return false;
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    if (Math.ceil((startHour * 60 + startMinute) / 30) * 30 + 30 > endHour * 60 + endMinute) {
      setError('Este tramo no permite una videollamada completa. Las citas empiezan a las horas en punto o a y media y duran 30 minutos. Amplía el horario.');
      return false;
    }
    return true;
  };

  const editWeekly = (slot: AvailabilitySlot) => {
    clearMessages();
    setWeeklyDraft({ id: slot.id, day_of_week: slot.day_of_week, start_time: time(slot.start_time), end_time: time(slot.end_time), is_active: slot.is_active });
  };
  const saveWeekly = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!weeklyDraft || !validateOpening(weeklyDraft.start_time, weeklyDraft.end_time)) return;
    void mutate('weekly-save', weeklyDraft.id ? 'PATCH' : 'POST', { kind: 'recurring', ...(weeklyDraft.id ? { id: weeklyDraft.id } : {}), day_of_week: weeklyDraft.day_of_week, start_time: weeklyDraft.start_time, end_time: weeklyDraft.end_time, is_active: weeklyDraft.is_active }, weeklyDraft.is_active ? 'Horario semanal guardado. Los clientes ya pueden elegir las horas disponibles.' : 'Horario semanal guardado. Este tramo permanece pausado.', () => setWeeklyDraft(null));
  };
  const toggleWeekly = (slot: AvailabilitySlot) => {
    void mutate(`toggle-${slot.id}`, 'PATCH', { kind: 'recurring', id: slot.id, day_of_week: slot.day_of_week, start_time: time(slot.start_time), end_time: time(slot.end_time), is_active: !slot.is_active }, slot.is_active ? `Tramo de ${DAYS[slot.day_of_week].toLowerCase()} pausado.` : `Tramo de ${DAYS[slot.day_of_week].toLowerCase()} activado.`);
  };
  const removeWeekly = (slot: AvailabilitySlot) => {
    void mutate(`remove-${slot.id}`, 'DELETE', { kind: 'recurring', id: slot.id }, 'Tramo semanal eliminado.', () => { if (weeklyDraft?.id === slot.id) setWeeklyDraft(null); });
  };

  const chooseDate = (date: string) => { clearMessages(); setDateDraft(makeDateDraft(date)); };
  const editDateRule = (rule: AvailabilityOverride) => {
    clearMessages();
    setDateDraft({ id: rule.id, date: rule.override_date, action: rule.is_available ? 'open' : rule.start_time ? 'block' : 'closed', start: rule.start_time ? time(rule.start_time) : '10:00', end: rule.end_time ? time(rule.end_time) : '14:00', note: rule.note || '', wholeDayOpening: rule.is_available && !rule.start_time && !rule.end_time });
  };
  const saveDateRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dateReady) return;
    if (!isCivilDate(dateDraft.date)) { setError('Selecciona una fecha válida.'); return; }
    const wholeDay = dateDraft.action === 'closed' || (dateDraft.action === 'open' && dateDraft.wholeDayOpening);
    if (!wholeDay && !(dateDraft.action === 'open' ? validateOpening(dateDraft.start, dateDraft.end) : validateRange(dateDraft.start, dateDraft.end))) return;
    void mutate('date-save', dateDraft.id ? 'PATCH' : 'POST', {
      kind: 'override', ...(dateDraft.id ? { id: dateDraft.id } : {}), override_date: dateDraft.date,
      start_time: wholeDay ? null : dateDraft.start, end_time: wholeDay ? null : dateDraft.end,
      is_available: dateDraft.action === 'open', note: dateDraft.note.trim() || null,
    }, 'Cambio guardado para esa fecha. El resto de semanas mantiene su horario habitual.', () => setDateDraft(makeDateDraft(dateDraft.date)));
  };
  const removeDateRule = (rule: AvailabilityOverride) => {
    void mutate(`remove-${rule.id}`, 'DELETE', { kind: 'override', id: rule.id }, 'Cambio de fecha eliminado. Vuelve a aplicarse el horario semanal y los demás cambios de ese día.', () => { if (dateDraft.id === rule.id) setDateDraft(makeDateDraft(rule.override_date)); });
  };

  const dateReady = dateRules.date === dateDraft.date && dateRules.rows !== null && !dateRules.loading;
  const selectedRules = dateReady ? [...dateRules.rows!].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')) : [];
  const otherDates = [...new Set(overrides.filter(rule => rule.override_date !== dateDraft.date).map(rule => rule.override_date))].sort();
  const selectedWeekly = isCivilDate(dateDraft.date) ? availability.filter(slot => slot.day_of_week === civilWeekday(dateDraft.date) && slot.is_active).sort((a, b) => a.start_time.localeCompare(b.start_time)) : [];
  const dateClosed = selectedRules.some(rule => !rule.is_available && !rule.start_time && !rule.end_time);

  return <section className="availability-manager" ref={editorRef} aria-labelledby={`${uid}-heading`} aria-busy={!!pending}>
    <header className="availability-manager__header">
      <div><h3 id={`${uid}-heading`}>Tu disponibilidad</h3><p>Define cuándo pueden reservar una videollamada contigo.</p></div>
      <span className="availability-manager__zone">Hora de Madrid</span>
    </header>
    <p className="availability-manager__hint">Videollamadas de 30 minutos. Empiezan en punto o a y media y dejan 30 minutos de margen entre citas. Los cambios afectan a nuevas reservas.</p>
    <div className="availability-manager__tabs" role="tablist" aria-label="Organizar disponibilidad">
      <button ref={weeklyTabRef} type="button" role="tab" id={`${uid}-weekly-tab`} aria-controls={`${uid}-weekly-panel`} aria-selected={tab === 'weekly'} tabIndex={tab === 'weekly' ? 0 : -1} disabled={busy} onClick={() => selectTab('weekly')} onKeyDown={keyboardTab}>Horario semanal</button>
      <button ref={datesTabRef} type="button" role="tab" id={`${uid}-dates-tab`} aria-controls={`${uid}-dates-panel`} aria-selected={tab === 'dates'} tabIndex={tab === 'dates' ? 0 : -1} disabled={busy} onClick={() => selectTab('dates')} onKeyDown={keyboardTab}>Fechas concretas</button>
    </div>
    {error && <p className="availability-manager__message availability-manager__message--error" role="alert">{error}</p>}
    {notice && <p className="availability-manager__message availability-manager__message--success" role="status">{notice}</p>}

    <div role="tabpanel" id={`${uid}-weekly-panel`} aria-labelledby={`${uid}-weekly-tab`} hidden={tab !== 'weekly'}>
      <p className="availability-manager__intro">Este horario se repite cada semana. Puedes añadir varios tramos en un día o pausarlos temporalmente.</p>
      <div className="availability-manager__week">
        {WEEK.map(day => {
          const daySlots = availability.filter(slot => slot.day_of_week === day).sort((a, b) => a.start_time.localeCompare(b.start_time));
          const editingHere = weeklyDraft?.day_of_week === day;
          return <div className="availability-manager__day" key={day}>
            <div className="availability-manager__day-name"><h4>{DAYS[day]}</h4><span>{daySlots.some(slot => slot.is_active) ? 'Disponible' : 'Sin horario activo'}</span></div>
            <div className="availability-manager__day-slots">
              {!daySlots.length && !editingHere && <span className="availability-manager__empty">Sin tramos añadidos</span>}
              {daySlots.map(slot => <div className={`availability-manager__slot${slot.is_active ? '' : ' availability-manager__slot--paused'}`} key={slot.id}>
                <div className="availability-manager__slot-time"><strong>{time(slot.start_time)}–{time(slot.end_time)}</strong><span className={`availability-manager__badge${slot.is_active ? '' : ' availability-manager__badge--muted'}`}>{slot.is_active ? 'Activo' : 'Pausado'}</span></div>
                <div className="availability-manager__actions">
                  <button type="button" disabled={busy} aria-label={`Editar tramo de ${DAYS[day].toLowerCase()} ${time(slot.start_time)} a ${time(slot.end_time)}`} onClick={() => editWeekly(slot)}>Editar</button>
                  <button type="button" disabled={busy} aria-label={`${slot.is_active ? 'Pausar' : 'Activar'} tramo de ${DAYS[day].toLowerCase()} ${time(slot.start_time)}`} onClick={() => toggleWeekly(slot)}>{pending === `toggle-${slot.id}` ? 'Guardando…' : slot.is_active ? 'Pausar' : 'Activar'}</button>
                  <button type="button" className="availability-manager__remove" disabled={busy} aria-label={`Eliminar tramo de ${DAYS[day].toLowerCase()} ${time(slot.start_time)}`} onClick={() => removeWeekly(slot)}>{pending === `remove-${slot.id}` ? 'Eliminando…' : 'Eliminar'}</button>
                </div>
              </div>)}
              {editingHere && weeklyDraft && <form className="availability-manager__weekly-form" onSubmit={saveWeekly}>
                <fieldset disabled={busy}>
                  <legend>{weeklyDraft.id ? 'Editar tramo' : 'Nuevo tramo'} · {DAYS[day]}</legend>
                  <div className="availability-manager__time-fields">
                    <label htmlFor={`${uid}-weekly-start`}>Desde<input id={`${uid}-weekly-start`} type="time" required step="60" value={weeklyDraft.start_time} onChange={event => setWeeklyDraft({ ...weeklyDraft, start_time: event.target.value })} /></label>
                    <label htmlFor={`${uid}-weekly-end`}>Hasta<input id={`${uid}-weekly-end`} type="time" required step="60" value={weeklyDraft.end_time} onChange={event => setWeeklyDraft({ ...weeklyDraft, end_time: event.target.value })} /></label>
                  </div>
                  <div className="availability-manager__form-actions"><button type="submit" className="availability-manager__primary">{pending === 'weekly-save' ? 'Guardando…' : 'Guardar tramo'}</button><button type="button" onClick={() => { setWeeklyDraft(null); clearMessages(); }}>Cancelar</button></div>
                </fieldset>
              </form>}
            </div>
            <button type="button" className="availability-manager__add" disabled={busy} aria-label={`Añadir tramo el ${DAYS[day].toLowerCase()}`} onClick={() => { clearMessages(); setWeeklyDraft({ day_of_week: day, start_time: '10:00', end_time: '14:00', is_active: true }); }}>+ Añadir tramo</button>
          </div>;
        })}
      </div>
    </div>

    <div role="tabpanel" id={`${uid}-dates-panel`} aria-labelledby={`${uid}-dates-tab`} hidden={tab !== 'dates'}>
      <p className="availability-manager__intro">Abre horas adicionales o bloquea una fecha sin cambiar tu horario semanal.</p>
      <div className="availability-manager__dates">
        <form className="availability-manager__date-form" onSubmit={saveDateRule}>
          <fieldset disabled={busy}>
            <legend>{dateDraft.id ? 'Editar cambio de fecha' : 'Añadir cambio de fecha'}</legend>
            <label htmlFor={`${uid}-date`}>Fecha<input id={`${uid}-date`} type="date" required value={dateDraft.date} onChange={event => setDateDraft({ ...dateDraft, date: event.target.value })} /></label>
            <fieldset className="availability-manager__choices"><legend>Qué quieres hacer</legend>
              {([
                { value: 'open', title: 'Abrir horas extra', text: 'Añadir un tramo a las horas habituales.' },
                { value: 'block', title: 'Bloquear unas horas', text: 'Reservar ese tiempo para ti.' },
                { value: 'closed', title: 'Cerrar todo el día', text: 'No aceptar nuevas citas ese día.' },
              ] as const).map(choice => <label className="availability-manager__choice" key={choice.value}><input type="radio" name={`${uid}-action`} value={choice.value} checked={dateDraft.action === choice.value} onChange={() => setDateDraft({ ...dateDraft, action: choice.value, wholeDayOpening: false })} /><span><strong>{choice.title}</strong><small>{choice.text}</small></span></label>)}
            </fieldset>
            {dateDraft.action !== 'closed' && !dateDraft.wholeDayOpening && <div className="availability-manager__time-fields">
              <label htmlFor={`${uid}-date-start`}>Desde<input id={`${uid}-date-start`} type="time" required step="60" value={dateDraft.start} onChange={event => setDateDraft({ ...dateDraft, start: event.target.value })} /></label>
              <label htmlFor={`${uid}-date-end`}>Hasta<input id={`${uid}-date-end`} type="time" required step="60" value={dateDraft.end} onChange={event => setDateDraft({ ...dateDraft, end: event.target.value })} /></label>
            </div>}
            {dateDraft.wholeDayOpening && <div className="availability-manager__whole-day"><p className="availability-manager__hint">Este cambio abre todo el día.</p><button type="button" onClick={() => setDateDraft({ ...dateDraft, wholeDayOpening: false })}>Limitar a un tramo horario</button></div>}
            <label htmlFor={`${uid}-note`}>Nota interna <span className="availability-manager__optional">(opcional)</span><input id={`${uid}-note`} type="text" maxLength={500} placeholder="Ej. Rodaje, vacaciones, horario especial…" value={dateDraft.note} onChange={event => setDateDraft({ ...dateDraft, note: event.target.value })} /></label>
            <div className="availability-manager__form-actions"><button type="submit" className="availability-manager__primary" disabled={!dateReady}>{pending === 'date-save' ? 'Guardando…' : dateDraft.id ? 'Guardar cambios' : 'Guardar fecha'}</button>{dateDraft.id && <button type="button" onClick={() => chooseDate(dateDraft.date)}>Cancelar edición</button>}</div>
          </fieldset>
        </form>
        <div className="availability-manager__date-summary">
          <h4>{isCivilDate(dateDraft.date) ? formatCivilDateES(dateDraft.date) : 'Selecciona una fecha'}</h4>
          <p className="availability-manager__hint">Horario habitual: {selectedWeekly.length ? selectedWeekly.map(slot => `${time(slot.start_time)}–${time(slot.end_time)}`).join(' · ') : 'sin horas abiertas'}.</p>
          {dateClosed && <p className="availability-manager__closure">Día cerrado. Para volver a abrir horas, elimina o edita el cierre de todo el día.</p>}
          <h5>Cambios para este día</h5>
          {isCivilDate(dateDraft.date) && (!dateRules.error || dateRules.date !== dateDraft.date) && !dateReady && <p className="availability-manager__empty" role="status">Consultando esta fecha…</p>}
          {dateRules.date === dateDraft.date && dateRules.error && <div className="availability-manager__date-load-error"><p className="availability-manager__message availability-manager__message--error" role="alert">{dateRules.error}</p><button type="button" disabled={busy} onClick={() => void loadDateRules(dateDraft.date)}>Volver a cargar esta fecha</button></div>}
          {dateReady && !selectedRules.length && <p className="availability-manager__empty">Sin cambios. Se aplica el horario semanal.</p>}
          <div className="availability-manager__rules">{selectedRules.map(rule => <article className={`availability-manager__rule${rule.is_available ? '' : ' availability-manager__rule--blocked'}`} key={rule.id}>
            <strong>{dateRuleLabel(rule)}</strong>{rule.note && <p>{rule.note}</p>}
            <div className="availability-manager__actions"><button type="button" disabled={busy} aria-label={`Editar ${dateRuleLabel(rule).toLowerCase()} del ${rule.override_date}`} onClick={() => editDateRule(rule)}>Editar</button><button type="button" className="availability-manager__remove" disabled={busy} aria-label={`Eliminar ${dateRuleLabel(rule).toLowerCase()} del ${rule.override_date}`} onClick={() => removeDateRule(rule)}>{pending === `remove-${rule.id}` ? 'Eliminando…' : 'Eliminar'}</button></div>
          </article>)}</div>
          <p className="availability-manager__hint availability-manager__precedence">Los bloqueos tienen prioridad sobre las horas abiertas. Las citas ya confirmadas se mantienen.</p>
          {!!otherDates.length && <div className="availability-manager__other-dates"><h5>Otras fechas con cambios</h5>{otherDates.map(date => <button type="button" key={date} disabled={busy} onClick={() => chooseDate(date)}><span>{formatCivilDateES(date)}</span><small>{overrides.filter(rule => rule.override_date === date).length} {overrides.filter(rule => rule.override_date === date).length === 1 ? 'cambio' : 'cambios'} →</small></button>)}</div>}
        </div>
      </div>
    </div>
  </section>;
}
