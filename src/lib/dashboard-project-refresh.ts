type ProjectForm = Record<string, string | number>;

/** Refresh saved fields while keeping edits the administrator is still writing. */
export function mergeDashboardProjectForm(current: ProjectForm, baseline: ProjectForm, saved: ProjectForm, linked: boolean): ProjectForm {
  return Object.fromEntries(Object.entries(saved).map(([key, value]) => [key,
    current[key] === baseline[key] || linked && ['status', 'client_id', 'client_name'].includes(key) ? value : current[key] ?? value,
  ]));
}
