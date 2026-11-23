import type { ReactNode } from 'react'

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function PanelCard({
  title,
  hint,
  action,
  children,
  toolbar,
  className = '',
}: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
  toolbar?: ReactNode
  className?: string
}) {
  return (
    <Card className={`panel-card ${className}`}>
      <CardHeader className="panel-card-header">
        <CardTitle><h2>{title}</h2></CardTitle>
        {hint && <CardDescription>{hint}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="panel-card-content">{toolbar}{children}</CardContent>
    </Card>
  )
}
