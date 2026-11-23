interface FeedDisplayEntry {
  text: unknown;
  level?: unknown;
  project_title?: unknown;
}

interface LogDisplayEntry {
  text: unknown;
  log_type?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function span(doc: Document, className: string, content: string): HTMLSpanElement {
  const element = doc.createElement('span');
  element.className = className;
  element.textContent = content;
  return element;
}

/** Activity from the API is plain text; none of it enters the HTML parser. */
export function createFeedEntry(
  entry: FeedDisplayEntry,
  time: string,
  doc: Document = document,
): HTMLDivElement {
  const isHigh = entry.level === 'high';
  const isLow = entry.level === 'low';
  const row = doc.createElement('div');
  row.className = `text-xs border-l-2 pl-2 py-1 feed-entry-new ${isHigh ? 'border-primary/30 bg-primary/5' : isLow ? 'border-slate-700' : 'border-primary/20'}`;
  row.append(span(doc, isLow ? 'text-slate-400' : 'text-primary/50', time));

  const projectTitle = text(entry.project_title);
  if (projectTitle) {
    row.append(span(doc, 'text-primary/40 ml-1', `[${projectTitle}]`));
  }
  row.append(doc.createTextNode(' '), span(doc, 'text-slate-300', text(entry.text)));
  return row;
}

export function createLogEntry(
  entry: LogDisplayEntry,
  time: string,
  doc: Document = document,
): HTMLParagraphElement {
  const isSuccess = entry.log_type === 'success';
  const isWarning = entry.log_type === 'warning';
  const label = isSuccess ? 'LISTO:' : isWarning ? 'AVISO:' : 'CORE:';
  const className = isSuccess ? 'text-green-500' : isWarning ? 'text-yellow-500' : 'text-primary';
  const row = doc.createElement('p');
  row.className = 'text-slate-500 log-entry-new';
  row.append(
    doc.createTextNode(`[${time}] `),
    span(doc, className, label),
    doc.createTextNode(` ${text(entry.text)}`),
  );
  return row;
}
