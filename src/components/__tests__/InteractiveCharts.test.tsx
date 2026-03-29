import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { chartState, i18nState } = vi.hoisted(() => ({
  chartState: {
    config: null as { characters?: { label?: string } } | null,
  },
  i18nState: {
    language: 'en' as 'en' | 'zh',
  },
}))

const translate = (key: string, options?: Record<string, unknown>): string => {
  const isChinese = i18nState.language === 'zh'

  switch (key) {
    case 'home.chart.title':
      return isChinese ? '\u8bc6\u522b\u91cf\u8d8b\u52bf' : 'Recognition volume'
    case 'home.chart.description':
      return isChinese
        ? '\u6240\u9009\u65f6\u95f4\u8303\u56f4\u5185\u7684\u8bc6\u522b\u5b57\u7b26\u6570'
        : 'Characters recognized in the selected range'
    case 'home.chart.seriesLabel':
      return isChinese ? '\u5b57\u7b26\u6570' : 'Characters'
    case 'home.chart.rangeSelectAriaLabel':
      return isChinese ? '\u9009\u62e9\u65f6\u95f4\u8303\u56f4' : 'Select time range'
    case 'home.chart.rangePlaceholder':
      return isChinese ? '\u6700\u8fd1 3 \u4e2a\u6708' : 'Last 3 months'
    case 'home.range.option': {
      const count = Number(options?.count ?? 0)
      return isChinese ? `\u6700\u8fd1 ${count} \u5929` : `Last ${count} days`
    }
    default:
      return key
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => translate(key, options),
    i18n: {
      language: i18nState.language,
    },
  }),
}))

vi.mock('recharts', () => ({
  Area: () => <div data-testid="area" />,
  AreaChart: ({ children }: { children: ReactNode }) => (
    <svg data-testid="area-chart" role="img">
      {children}
    </svg>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
}))

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({
    children,
    config,
  }: {
    children: ReactNode
    config: { characters?: { label?: string } }
  }) => {
    chartState.config = config
    return <div data-testid="chart-container">{children}</div>
  },
  ChartLegend: ({ content }: { content: ReactNode }) => (
    <div data-testid="chart-legend">{content}</div>
  ),
  ChartLegendContent: () => (
    <div data-testid="legend-label">{chartState.config?.characters?.label}</div>
  ),
  ChartTooltip: ({ content }: { content: ReactNode }) => (
    <div data-testid="chart-tooltip">{content}</div>
  ),
  ChartTooltipContent: () => (
    <div data-testid="tooltip-label">{chartState.config?.characters?.label}</div>
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <div data-testid={`range-option-${value}`}>{children}</div>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span data-testid="range-placeholder" data-placeholder={placeholder} />
  ),
}))

import InteractiveCharts from '../InteractiveCharts'

describe('InteractiveCharts', () => {
  it('localizes chart legend, tooltip, and range select labels', () => {
    const historyItems = [
      {
        id: '1',
        text: 'hello world',
        timestamp: new Date('2026-03-29T08:00:00.000Z').getTime(),
        duration: 1200,
      },
    ]

    i18nState.language = 'en'
    const { rerender } = render(<InteractiveCharts historyItems={historyItems} loading={false} />)

    expect(screen.getByTestId('legend-label')).toHaveTextContent('Characters')
    expect(screen.getByTestId('tooltip-label')).toHaveTextContent('Characters')
    expect(screen.getByRole('button', { name: 'Select time range' })).toBeInTheDocument()
    expect(screen.getByTestId('range-placeholder')).toHaveAttribute(
      'data-placeholder',
      'Last 3 months',
    )
    expect(screen.getByTestId('range-option-90d')).toHaveTextContent('Last 90 days')

    i18nState.language = 'zh'
    rerender(<InteractiveCharts historyItems={historyItems} loading={false} />)

    expect(screen.getByTestId('legend-label')).toHaveTextContent('\u5b57\u7b26\u6570')
    expect(screen.getByTestId('tooltip-label')).toHaveTextContent('\u5b57\u7b26\u6570')
    expect(
      screen.getByRole('button', { name: '\u9009\u62e9\u65f6\u95f4\u8303\u56f4' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('range-placeholder')).toHaveAttribute(
      'data-placeholder',
      '\u6700\u8fd1 3 \u4e2a\u6708',
    )
    expect(screen.getByTestId('range-option-90d')).toHaveTextContent('\u6700\u8fd1 90 \u5929')
    expect(screen.queryByText('Characters')).not.toBeInTheDocument()
  })
})
