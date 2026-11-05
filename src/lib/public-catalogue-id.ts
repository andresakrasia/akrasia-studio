/** Slugs are public catalogue selectors; they never identify private sessions. */
export const isProjectSlug = (value: unknown): value is string => typeof value === 'string' &&
  value.length <= 120 && /^[a-z0-9]+(?:-[a-z0-9]+)*$(?![\s\S])/.test(value);
