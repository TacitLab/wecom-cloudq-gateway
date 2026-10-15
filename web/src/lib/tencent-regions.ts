export const TENCENT_REGIONS = [
  { id: 'ap-beijing', name: '北京' },
  { id: 'ap-shanghai', name: '上海' },
  { id: 'ap-nanjing', name: '南京' },
  { id: 'ap-guangzhou', name: '广州' },
  { id: 'ap-chengdu', name: '成都' },
  { id: 'ap-chongqing', name: '重庆' },
  { id: 'ap-zhongwei', name: '中卫' },
  { id: 'ap-hongkong', name: '中国香港' },
  { id: 'ap-beijing-fsi', name: '北京金融' },
  { id: 'ap-shanghai-fsi', name: '上海金融' },
  { id: 'ap-shenzhen-fsi', name: '深圳金融' },
  { id: 'ap-shanghai-adc', name: '上海自动驾驶云' },
  { id: 'ap-singapore', name: '新加坡' },
  { id: 'ap-jakarta', name: '雅加达' },
  { id: 'ap-seoul', name: '首尔' },
  { id: 'ap-tokyo', name: '东京' },
  { id: 'ap-bangkok', name: '曼谷' },
  { id: 'me-saudi-arabia', name: '沙特阿拉伯' },
  { id: 'sa-saopaulo', name: '圣保罗' },
  { id: 'na-siliconvalley', name: '硅谷' },
  { id: 'na-ashburn', name: '弗吉尼亚' },
  { id: 'eu-frankfurt', name: '法兰克福' },
] as const

export function tencentRegionName(id: string) {
  return TENCENT_REGIONS.find((region) => region.id === id)?.name
}
