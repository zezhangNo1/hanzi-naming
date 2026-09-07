/**
 * env.js — 前端环境配置
 * 注意：
 * 1. CLOUD_ENV 为云开发环境 ID 占位，部署时替换为真实环境 ID（dev / prod 各一个，见 docs/deploy.md）；
 * 2. 本文件只放「非敏感」前端常量。LLM 相关的三个密钥型环境变量
 *    （API Key / 接口地址 / 模型名）只能配置在云函数环境变量中（微信云开发控制台），
 *    严禁出现在 miniprogram/ 下任何文件（含注释，验收以 grep 零命中为准）。
 */
module.exports = {
  /** 云开发环境 ID 占位：部署前替换，如 "hanzi-dev-8g0xxx" */
  CLOUD_ENV: 'cloud1-d7g7dev8ec78ed7b5',

  /** 小程序版本号（与提审版本对齐，便于埋点分析分版本观察） */
  VERSION: '0.1.0',

  /** 免费批次上限（前端展示常量，用于 UI 文案；真实额度校验以云函数服务端为准） */
  FREE_BATCH_LIMIT: 2
};
