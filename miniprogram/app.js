/**
 * app.js — 小程序入口
 * 职责：云开发环境初始化（环境 ID 从 config/env.js 读取）、埋点底座初始化与离线事件补发。
 * 安全约定：LLM 相关密钥只存云函数环境变量，前端任何文件不得出现密钥字面值（验收以 grep 零命中为准，注释中也不写变量名）。
 */
const { CLOUD_ENV } = require('./config/env');
const tracker = require('./utils/tracker');

App({
  /** 全局共享数据（后续任务按需挂载） */
  globalData: {
    version: require('./config/env').VERSION
  },

  onLaunch() {
    // 1. 云开发初始化：env 支持占位符替换，dev/prod 分环境管理成本
    if (!wx.cloud) {
      console.error('当前基础库过低，无法使用云能力，请升级基础库 ≥ 2.2.3');
      return;
    }
    wx.cloud.init({
      env: CLOUD_ENV,
      traceUser: true
    });

    // 2. 埋点底座初始化（隐私授权同意后才会真正上报，见 tracker.setConsent）
    tracker.init();

    // 3. 补发离线事件（上次弱网/飞行模式期间缓存的事件）
    tracker.flushOffline();
  },

  onShow() {
    // 预留：启动场景值采集（scene），后续任务接入 tracker.track('enter', {...})
  }
});
