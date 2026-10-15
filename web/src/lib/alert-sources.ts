export const ALERT_SOURCES = [
  { id: 'MT_QCE', name: '云产品监控', description: 'CVM、数据库、负载均衡等云资源告警' },
  { id: 'MT_TAW', name: '应用性能监控 APM', description: '应用、接口、错误率及响应耗时告警' },
  { id: 'MT_CLS', name: '日志服务 CLS', description: '日志查询与分析触发的原生告警' },
]

export function alertSourceName(monitorType: string) {
  return ALERT_SOURCES.find((source) => source.id === monitorType)?.name ?? monitorType
}
