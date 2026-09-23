// 临时冒烟测试：用最小 window/localStorage 垫片跑业务规则与存储
const fs = require("fs");
const path = require("path");

const mem = {};
global.window = global;
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
global.crypto = require("crypto").webcrypto;

function load(f) {
  const code = fs.readFileSync(path.join(__dirname, f), "utf8");
  eval(code);
}
load("js/rules.js");
load("js/storage.js");

const R = global.QXRules, S = global.QXStore, s = S.state;
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra || ""); }
}
function expectThrow(name, fn, frag) {
  try { fn(); check(name, false, "未抛错"); }
  catch (e) { check(name + (frag ? `（${frag}）` : ""), !frag || e.message.includes(frag), e.message); }
}

const DAY = 86400000;
const HOUR = 3600000;
const w = s.works[0];
const bGood = s.batches[0];   // 8.6% 启用
const bWet = s.batches[1];    // 13.4%
const bOff = s.batches[2];    // 停用

console.log("1. 批次门槛");
check("8.6% 启用可占位", R.batchReady(bGood).ok);
check("13.4% 超含水率拦截", !R.batchReady(bWet).ok);
check("停用批次拦截", !R.batchReady(bOff).ok);

console.log("2. 一件作品一张未结束单");
const order0 = S.openOrderOf(w.id);
check("种子中已有未结束单", !!order0 && order0.status === "drying");
const again = S.openRepairOrder({ workId: w.id, batchId: bGood.id, repairer: "X", repairedAt: new Date().toISOString(), baseWeight: 100 });
check("重复开单沿用首次结果", again.reused && again.order.id === order0.id);

console.log("3. 已占柜位重复占位沿用首次结果");
const occ = S.occupySlot(order0.id, s.slots[1].id);
check("重复占位不换柜", occ.reused && occ.order.slotId === s.slots[0].id);

console.log("4. 合格两次称重 + 批缝闭合 → 准入（并发合并，重复沿用缓存）");
const [p1, p2] = [S.requestAdmission(order0.id), S.requestAdmission(order0.id)];
Promise.all([p1, p2]).then(([d1, d2]) => {
  check("并发返回同一 Promise 结果", d1.passed && d2.passed);
  check("准入后单据结束", order0.status === "done");
  check("准入后释放柜位", !order0.slotId && S.freeSlots().length === s.slots.length);
  check("作品进入上金粉", S.getWork(w.id).status === "上金粉");
  return S.requestAdmission(order0.id);
}).then(d3 => {
  check("指纹不变沿用首次结果", d3.reused === true && d3.passed);

  console.log("5. 湿批/停批不得占位（新作品新单）");
  const w2 = s.works[2]; // 无单
  const mk = (batchId) => S.openRepairOrder({
    workId: w2.id, batchId, reason: "t", repairer: "陈师傅",
    repairedAt: new Date().toISOString(), baseWeight: 300
  });
  expectThrow("湿批开单即拦截", () => mk(bWet.id), "含水率");
  expectThrow("停批开单即拦截", () => mk(bOff.id), "停用");
  expectThrow("缺初称重量拦截", () => S.openRepairOrder({
    workId: w2.id, batchId: bGood.id, repairer: "陈师傅",
    repairedAt: new Date().toISOString(), baseWeight: 0
  }), "初称");
  const r = mk(bGood.id);
  S.saveBatch({ id: bGood.id, code: bGood.code, ash: bGood.ash, moisture: bGood.moisture, active: false });
  expectThrow("占位时批次停用拦截", () => S.occupySlot(r.order.id, null), "停用");
  S.saveBatch({ id: bGood.id, code: bGood.code, ash: bGood.ash, moisture: 14, active: true });
  expectThrow("占位时含水率 14% 拦截", () => S.occupySlot(r.order.id, null), "12%");
  S.saveBatch({ id: bGood.id, code: bGood.code, ash: bGood.ash, moisture: 8.6, active: true });
  S.occupySlot(r.order.id, null);
  check("恢复后占位成功", r.order.status === "drying");

  console.log("6. 称重规则：换人 + 24h + 失重区间");
  expectThrow("修补人本人称重拦截", () => S.addWeighing(r.order.id, {
    person: "陈师傅", weight: 299, at: new Date(Date.now() + 25 * HOUR).toISOString()
  }), "换人");
  expectThrow("不足 24h 拦截", () => S.addWeighing(r.order.id, {
    person: "林师傅", weight: 299, at: new Date(Date.now() + HOUR).toISOString()
  }), "24");
  // 第一次称重：300 → 297，失重 1.000%，超 0.6%
  S.addWeighing(r.order.id, {
    person: "林师傅", weight: 297, at: new Date(Date.now() + 25 * HOUR).toISOString()
  });
  check("失重 1% 的称重可录入（准入时才判定）", r.order.weighings.length === 1);
  // 第二次称重：297 → 296，失重 0.337%（区间内，但第一段越界）
  S.addWeighing(r.order.id, {
    person: "周师傅", weight: 296, at: new Date(Date.now() + 49 * HOUR).toISOString()
  });
  return S.requestAdmission(r.order.id);
}).then((d4) => {
  check("两段缺一越界 → 准入失败", !d4.passed && d4.reasons.some(x => x.includes("不在")));
  const o2 = S.openOrderOf(s.works[2].id);
  check("准入失败继续占位", o2.status === "drying" && !!o2.slotId);
  check("批次若中途停用也会挡住准入", (() => {
    S.saveBatch({ id: bGood.id, code: bGood.code, ash: bGood.ash, moisture: 8.6, active: false });
    return true;
  })());
  return S.requestAdmission(o2.id);
}).then((d5) => {
  check("批次停用后再次准入被拒", !d5.passed && d5.reasons.some(x => x.includes("停用")));
  check("仍继续占位", s.orders.find(o => o.id === d5 && false) || S.openOrderOf(s.works[2].id).slotId != null);
  S.saveBatch({ id: bGood.id, code: bGood.code, ash: bGood.ash, moisture: 8.6, active: true });

  console.log("7. 胎体/纹样修正 → 准入失效、按新值重算");
  const o2 = S.openOrderOf(s.works[2].id);
  S.correctWork(s.works[2].id, { base: "改胎-夹纻胎", theme: s.works[2].theme });
  check("称重/初称已清空", o2.weighings.length === 0 && !o2.baseWeight);
  check("drying 单修正后继续占位", o2.status === "drying" && !!o2.slotId);
  check("判定缓存已失效", o2.decision === null);
  const doneOrder = s.orders.find(o => o.workId === w.id && o.status === "done");
  S.correctWork(w.id, { base: w.base, theme: "海水江崖·改" });
  check("已准入单失效关闭", doneOrder.status === "closed" && doneOrder.voided);
  check("作品退回待阴干", S.getWork(w.id).status === "待阴干");
  check("履历有修正事件", s.history.some(h => h.text.includes("准入全部失效")));

  console.log("8. 结束单据释放柜位");
  S.closeOrder(o2.id, "测试收尾");
  check("closed 后释放柜位", !o2.slotId && S.freeSlots().length === s.slots.length);

  console.log("9. 持久化：刷新后状态一致");
  const saved = JSON.parse(mem["qxRepairConsole.v1"]);
  check("localStorage 已写入", !!saved && saved.orders.length >= 2);
  check("看板/柜位/履历同源数量一致",
    saved.works.length === s.works.length && saved.history.length === s.history.length);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
