# parsing_rules

站点解析规则目录（JSON/YAML/TS 均可）。

## 规则建议字段

- `site`: 域名或匹配表达式
- `titleSelector`: 标题选择器
- `contentSelector`: 主体选择器
- `removeSelectors`: 需要剔除的广告/导航
- `imageSelector`: 图片提取选择器
- `authorSelector`: 作者选择器
- `dateSelector`: 日期选择器
- `version`: 规则版本

## 运行策略

1. 命中规则 -> 按规则解析
2. 未命中 -> Readability 默认解析
3. 失败 -> Playwright 动态兜底
