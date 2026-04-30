/**
 * ElevateOS Dashboard - Chart theme configuration.
 * Elevation course palette for all Recharts components.
 */

// -- Color palette --

export const CHART_PRIMARY = '#1B2A4A';
export const CHART_PRIMARY_LIGHT = '#8DA2D1';
export const CHART_PRIMARY_DARK = '#121D35';
export const CHART_PRIMARY_MUTED = 'rgba(27, 42, 74, 0.15)';

// Aliases retained from ElevateOS so existing components don't need re-imports.
export const CHART_GOLD = CHART_PRIMARY;
export const CHART_GOLD_LIGHT = CHART_PRIMARY_LIGHT;
export const CHART_GOLD_DARK = CHART_PRIMARY_DARK;
export const CHART_GOLD_MUTED = CHART_PRIMARY_MUTED;

export const CHART_COLORS = [
  '#1B2A4A', // navy
  '#CE823E', // copper/orange
  '#044B35', // forest logo green
  '#35415b', // charcoal
  '#E6E6E3', // light gray
  '#2B2B2B', // near black
] as const;

// -- Model-specific colors (for cost charts) --

export const MODEL_COLORS: Record<string, string> = {
  opus: '#1B2A4A',
  sonnet: '#044B35',
  haiku: '#CE823E',
};

// -- Severity colors --

export const SEVERITY_COLORS: Record<string, string> = {
  info: '#1B2A4A',
  warning: '#CE823E',
  error: '#EF4444',
};

// -- Recharts default props --

export const AXIS_STYLE = {
  fontSize: 11,
  fill: 'var(--muted-foreground)',
  tickLine: false,
  axisLine: false,
} as const;

export const GRID_STYLE = {
  strokeDasharray: '3 3',
  stroke: 'var(--border)',
  strokeOpacity: 0.5,
} as const;

export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 12,
    padding: '8px 12px',
    color: 'var(--foreground)',
  },
  labelStyle: {
    color: 'var(--foreground)',
    fontSize: 11,
    fontWeight: 500,
    marginBottom: 4,
  },
  itemStyle: {
    color: 'var(--foreground)',
  },
} as const;

// -- Helper functions --

/** Get a color by index, cycling through CHART_COLORS */
export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/** Get a model color with fallback */
export function getModelColor(model: string): string {
  const key = model.toLowerCase();
  for (const [name, color] of Object.entries(MODEL_COLORS)) {
    if (key.includes(name)) return color;
  }
  return CHART_COLORS[0];
}

/** Generate a gradient ID for an area chart */
export function gradientId(prefix: string, index: number = 0): string {
  return `${prefix}-gradient-${index}`;
}
