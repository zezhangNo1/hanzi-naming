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
    if (!CLOUD_ENV || CLOUD_ENV.indexOf('PLACEHOLDER') > -1) {
      // 未配置环境 ID：使用默认环境（开发者工具「云开发」控制台中创建的第一个环境）
      console.warn('[cloud] config/env.js 的 CLOUD_ENV 尚未配置，正在使用默认云环境。'
        + '正式开发请开通云开发后，将环境 ID 填入 miniprogram/config/env.js');
      wx.cloud.init({ traceUser: true });
    } else {
      wx.cloud.init({
        env: CLOUD_ENV,
        traceUser: true
      });
    }

    // 2. 埋点底座初始化（隐私授权同意后才会真正上报，见 tracker.setConsent）
    tracker.init();

    // 3. 补发离线事件（上次弱网/飞行模式期间缓存的事件）
    tracker.flushOffline();
  },

  onShow() {
    // 预留：启动场景值采集（scene），后续任务接入 tracker.track('enter', {...})
  }
});
