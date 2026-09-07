/**
 * generate 云函数 — 起名主流程（B2 降级版实现）
 *
 * B2 范围：create/poll 双 action；create 完成校验 → 额度 → 缓存查重 → 建 job
 * → 同步执行降级流水线（规则引擎 <1s，poll 兼容 pending/done）→ 落库。
 * 环境变量（云开发控制台配置，严禁写进代码）：LLM_API_KEY、LLM_BASE_URL、LLM_MODEL、
 * FREE_BATCH_LIMIT、AD_BATCH_LIMIT（config.json 中为字符串，取用时 parseInt）。
 * 鉴权：context.OPENID，前端不传身份。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const cloudContext = cloud.getWXContext();

const quota = require('./lib/quota');
const cache = require('./lib/cache');
const pipeline = require('./lib/pipeline');

/** 统一响应包装 */
function ok(data) {
  return { code: 0, msg: 'ok', data: data };
}
function fail(code, msg) {
  return { code: code, msg: msg, data: null };
}

/** 姓氏校验：必须 1 个汉字（含扩展区） */
function isValidSurname(surname) {
  return typeof surname === 'string'
    && Array.from(surname.trim()).length === 1
    && /[\u3400-\u9FFF\uF900-\uFAFF]/.test(surname.trim());
}

/**
 * action: create — 创建生成任务（B2 同步降级，返回即 done；契约保持 pending→done 兼容）
 * 入参：{ surname, gender, styles, constraints, source, batch }
 * 出参：{ jobId, status, candidates?, degraded?, quota? }
 */
async function handleCreate(event) {
  const surname = (event.surname || '').trim();
  const gender = event.gender === 'female' ? 'female' : 'male';
  const styles = Array.isArray(event.styles) ? event.styles.filter((s) => typeof s === 'string') : [];
  const constraints = normalizeConstraints(event.constraints);
  const source = ['free', 'ad', 'paid'].includes(event.source) ? event.source : 'free';
  const batch = Math.max(1, parseInt(event.batch, 10) || 1);
  const openid = cloudContext.OPENID;

  // 1. 输入校验（姓氏 1 字）
  if (!isValidSurname(surname)) {
    return fail(1001, '姓氏需为 1 个汉字');
  }

  // 2. 额度校验 + 扣减（free/ad/paid 三源；超限 2001）
  const quotaResult = await quota.checkAndConsume(db, openid, source);
  if (!quotaResult.ok) {
    return fail(quotaResult.code, quotaResult.msg);
  }

  // 6. 缓存查重：同参同批命中 → 直接返回既有结果（不重复扣批次可接受口径：命中不消耗新内容额度，但已扣减，B2 记录之）
  const hash = cache.jobHash({ surname: surname, gender: gender, styles: styles, constraints: constraints, batch: batch });
  const cached = await cache.lookup(db, openid, hash);
  if (cached) {
    const q = await quota.quotaOf(db, openid);
    const cands = await loadCandidates(cached.candidateIds);
    return ok({
      jobId: cached._id,
      status: 'done',
      cached: true,
      candidates: cands,
      degraded: !!cached.degraded,
      quota: q
    });
  }

  // 建任务（status=pending；B2 同步执行，写库前先落 pending 以兼容 poll 语义）
  const now = Date.now();
  const jobData = {
    _openid: openid,
    surname: surname,
    gender: gender,
    styles: styles,
    constraints: constraints,
    status: 'pending',
    source: source,
    batch: batch,
    hash: hash,
    candidateIds: [],
    degraded: false,
    latencyMs: 0,
    createdAt: now,
    updatedAt: now
  };
  const jobAdded = await db.collection('name_jobs').add({ data: jobData });
  const jobId = jobAdded._id;

  // 同步执行降级流水线（B2 不做异步；降级引擎 <1s）
  let result;
  try {
    result = await pipeline.run({
      jobId: jobId,
      openid: openid,
      surname: surname,
      gender: gender,
      styles: styles,
      constraints: constraints,
      source: source,
      batch: batch
    });
  } catch (err) {
    console.error('[generate] 流水线失败：', err);
    await db.collection('name_jobs').doc(jobId).update({
      data: { status: 'failed', updatedAt: Date.now() }
    }).catch(() => {});
    return fail(5000, '生成失败，请重试');
  }

  const q = await quota.quotaOf(db, openid);
  return ok({
    jobId: jobId,
    status: 'done',
    cached: false,
    degraded: result.degraded,
    quota: q
  });
}

/**
 * action: poll — 轮询任务结果
 * 入参：{ jobId }
 * 出参：{ status, candidates?, degraded, quota }（pending/done 双态兼容）
 */
async function handlePoll(event) {
  const jobId = event.jobId;
  if (!jobId || typeof jobId !== 'string') {
    return fail(1001, '缺少 jobId');
  }
  const openid = cloudContext.OPENID;
  const found = await db.collection('name_jobs').doc(jobId).get().catch(() => null);
  if (!found || !found.data) {
    return fail(1001, '任务不存在');
  }
  const job = found.data;
  if (job._openid !== openid) {
    return fail(1001, '任务不存在');
  }

  const q = await quota.quotaOf(db, openid);
  if (job.status === 'done') {
    const cands = await loadCandidates(job.candidateIds);
    return ok({
      status: 'done',
      candidates: cands,
      degraded: !!job.degraded,
      quota: q
    });
  }
  if (job.status === 'failed') {
    return ok({ status: 'failed', candidates: [], degraded: false, quota: q });
  }
  // pending（B2 理论不出现，保留兼容）
  return ok({ status: 'pending', candidates: [], degraded: false, quota: q });
}

/** 规范化 constraints（对齐 name_jobs schema，全部可选） */
function normalizeConstraints(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    birth: c.birth === undefined ? null : c.birth, // 敏感项：仅哈希/授权后传入，B2 恒 null
    generationChar: typeof c.generationChar === 'string' ? Array.from(c.generationChar.trim())[0] || '' : '',
    avoidChars: Array.isArray(c.avoidChars) ? c.avoidChars.filter((x) => typeof x === 'string' && x.length >= 1).slice(0, 20) : [],
    wishes: typeof c.wishes === 'string' ? c.wishes.slice(0, 50) : '',
    dialects: Array.isArray(c.dialects) ? c.dialects.filter((d) => ['yue', 'xic', 'wu', 'min', 'hak'].includes(d)) : []
  };
}

/** 按 candidateIds 拉取候选文档（保持传入顺序） */
async function loadCandidates(candidateIds) {
  const ids = candidateIds || [];
  if (ids.length === 0) return [];
  const MAX_IN = 100; // 云数据库 where-in 上限内
  const slice = ids.slice(0, MAX_IN);
  const found = await db.collection('candidates')
    .where({ _id: db.command.in(slice) })
    .limit(MAX_IN)
    .get();
  const byId = {};
  for (const doc of found.data || []) byId[doc._id] = doc;
  return slice.map((id) => byId[id]).filter(Boolean);
}

/** action 路由表（接口契约见交接包 3.1） */
const ACTIONS = {
  create: handleCreate,
  poll: handlePoll
};

exports.main = async (event, context) => {
  const action = event && event.action;
  const handler = ACTIONS[action];
  if (!handler) {
    return fail(1001, '未知 action: ' + action);
  }
  try {
    return await handler(event, context);
  } catch (err) {
    console.error('[generate] 处理失败：', action, err);
    return fail(5000, '服务内部错误');
  }
};
