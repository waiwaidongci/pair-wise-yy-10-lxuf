/*
 * 批缝补灰与复阴干准入台 —— 页面层
 * 只负责渲染与交互；数据变更全部走 QXStore，判定口径全部来自 QXRules。
 * 看板、柜位、履历同源于 QXStore.state，刷新后一致。
 */
(function () {
  "use strict";

  var Store = window.QXStore;
  var R = window.QXRules;
  var s = Store.state;

  var STATUSES = ["贴线中", "待阴干", "上金粉", "待交付"];
  var ORDER_BADGE = {
    open: ["补灰中", "amber"],
    drying: ["占阴干位", "red"],
    done: ["已准入金粉", "teal"],
    closed: ["已结束", "muted"]
  };

  /* ---------- 小工具 ---------- */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function el(id) { return document.getElementById(id); }

  function datetimeLocalValue(d) {
    d = d || new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function latestOrder(workId) {
    var list = s.orders.filter(function (o) { return o.workId === workId; });
    return list.length ? list[list.length - 1] : null;
  }

  function weighingRatios(order) {
    var out = [];
    var prev = order.baseWeight;
    order.weighings.forEach(function (e) {
      out.push(R.lossRatio(prev, e.weight));
      prev = e.weight;
    });
    return out;
  }

  function toast(text, ok) {
    var t = el("toast");
    t.textContent = text;
    t.className = "show " + (ok ? "ok" : "err");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.className = ""; }, 2600);
  }

  function tryRun(fn) {
    try {
      var ret = fn();
      render();
      return ret;
    } catch (e) {
      toast(e.message, false);
    }
  }

  /* ---------- 通用弹窗 ---------- */

  var dlg = el("dlg");
  function openDialog(title, bodyHTML, actions) {
    el("dlgTitle").textContent = title;
    el("dlgBody").innerHTML = bodyHTML;
    var box = el("dlgActions");
    box.innerHTML = "";
    (actions || []).forEach(function (a) {
      var btn = document.createElement("button");
      btn.className = a.cls || "";
      btn.textContent = a.label;
      btn.addEventListener("click", function () { a.onClick && a.onClick(closeDialog); });
      box.appendChild(btn);
    });
    dlg.showModal();
  }
  function closeDialog() { dlg.close(); }

  function formDialog(title, fieldsHTML, submitLabel, onSubmit) {
    var html =
      '<form id="dlgForm" class="dlg-form">' + fieldsHTML +
      '<div id="dlgError" class="form-error" hidden></div></form>';
    openDialog(title, html, [
      { label: submitLabel, onClick: function (close) {
          var form = el("dlgForm");
          var data = {};
          new FormData(form).forEach(function (v, k) { data[k] = v; });
          var activeEl = form.elements["active"];
          data["__active"] = activeEl ? activeEl.checked : undefined;
          try {
            onSubmit(data, close);
          } catch (e) {
            var err = el("dlgError");
            err.hidden = false;
            err.textContent = e.message;
          }
        } },
      { label: "取消", cls: "secondary", onClick: function (close) { close(); } }
    ]);
  }

  /* ---------- 渲染：批次 / 柜位 ---------- */

  function renderBatches() {
    el("batchList").innerHTML = s.batches.map(function (b) {
      var hot = !(Number(b.moisture) <= R.RULES.MOISTURE_LIMIT);
      var used = s.orders.some(function (o) { return o.batchId === b.id && R.isOpen(o); });
      return '<div class="row ' + (!b.active ? "off" : "") + '">' +
        '<div><b>' + esc(b.code) + '</b>' +
        '<span class="tag ' + (b.active ? "teal" : "muted") + '">' + (b.active ? "启用中" : "已停用") + '</span>' +
        (used ? '<span class="tag violet">在用</span>' : "") +
        '<div class="meta">' + esc(b.ash || "未注明灰料") + '</div></div>' +
        '<div class="row-right"><span class="num ' + (hot ? "bad" : "good") + '">' +
        Number(b.moisture).toFixed(1) + '%</span>' +
        '<button class="secondary mini-btn" onclick="QXPage.editBatch(\'' + b.id + '\')">编辑</button></div></div>';
    }).join("");
  }

  function renderSlots() {
    el("slotList").innerHTML = s.slots.map(function (slot) {
      var o = Store.occupyingOrder(slot.id);
      if (!o) {
        return '<div class="slot free"><h3>' + esc(slot.code) + '</h3>' +
          '<span class="tag teal">空柜位</span></div>';
      }
      var w = Store.getWork(o.workId);
      var b = Store.getBatch(o.batchId);
      return '<div class="slot busy"><h3>' + esc(slot.code) + '</h3>' +
        '<b>' + esc(w ? w.theme : "?") + '</b>' +
        '<div class="meta">批次 ' + esc(b ? b.code : "?") + "<br>" +
        "第 " + o.weighings.length + "/2 次称重 · " + (o.seamClosed ? "批缝已闭合" : "批缝未闭合") + '</div>' +
        '<button class="mini-btn" onclick="QXPage.showOrderDetail(\'' + o.id + '\')">补灰单</button></div>';
    }).join("");
  }

  /* ---------- 渲染：看板 ---------- */

  function filteredWorks() {
    var fStatus = el("statusFilter").value;
    var fTheme = el("themeFilter").value.trim();
    var sort = el("sortMode").value;
    return s.works
      .filter(function (w) { return !fStatus || w.status === fStatus; })
      .filter(function (w) { return !fTheme || w.theme.includes(fTheme); })
      .slice()
      .sort(function (a, b) { return String(a[sort] || "").localeCompare(String(b[sort] || "")); });
  }

  function orderBlock(w) {
    var o = latestOrder(w.id);
    if (!o) {
      return '<div class="orderline none">无补灰单</div>' +
        '<button class="violet mini-btn" onclick="QXPage.openOrderDialog(\'' + w.id + '\')">开补灰单</button>';
    }
    var b = Store.getBatch(o.batchId);
    var badge = ORDER_BADGE[o.voided && o.status === "closed" ? "closed" : o.status] || ORDER_BADGE.closed;
    var label = o.voided ? "准入失效" : badge[0];
    var ratios = weighingRatios(o);
    var html = '<div class="orderline">' +
      '<span class="tag ' + badge[1] + '">' + label + '</span>' +
      '<span class="meta">批次 ' + esc(b ? b.code : "?") +
      (o.slotId ? " · " + esc(Store.getSlot(o.slotId).code) : "") + '</span></div>';
    html += '<div class="meta">初称 ' + (o.baseWeight ? o.baseWeight.toFixed(2) + "g" : "已清空") +
      " · 称重 " + ratios.map(function (r) { return R.formatPercent(r); }).join(" / ") +
      " · 批缝 " + (o.seamClosed ? "已闭合" : "未闭合") + '</div>';

    if (R.isOpen(o)) {
      var n = o.weighings.length + 1;
      html += '<div class="card-actions">' +
        (o.status === "open"
          ? '<button class="mini-btn" onclick="QXPage.occupyDialog(\'' + o.id + '\')">占阴干位</button>'
          : '') +
        (o.weighings.length < 2
          ? '<button class="mini-btn" onclick="QXPage.weighDialog(\'' + o.id + '\')">第' + n + '次称重</button>'
          : '<button class="mini-btn" disabled>称重完成</button>') +
        '<button class="warn mini-btn" onclick="QXPage.seamDialog(\'' + o.id + '\')">' +
        (o.seamClosed ? "撤销批缝" : "批缝闭合") + '</button>' +
        '<button class="teal mini-btn" onclick="QXPage.admit(\'' + o.id + '\')">准入判定</button>' +
        '<button class="danger mini-btn" onclick="QXPage.closeOrderDialog(\'' + o.id + '\')">结束单</button>' +
        '</div>';
    } else {
      html += '<div class="card-actions">' +
        '<button class="secondary mini-btn" onclick="QXPage.showOrderDetail(\'' + o.id + '\')">单据履历</button>' +
        '<button class="violet mini-btn" onclick="QXPage.openOrderDialog(\'' + w.id + '\')">再开补灰单</button>' +
        '</div>';
    }

    if (o.decision) {
      html += o.decision.passed
        ? '<div class="decision pass">判定通过：准入金粉（' + new Date(o.decision.at).toLocaleString() + "）</div>"
        : '<div class="decision fail">判定未通过，继续占位：' +
          esc(o.decision.reasons.slice(0, 2).join("；")) + '</div>';
    }
    return html;
  }

  function renderBoard() {
    var list = filteredWorks();
    el("board").innerHTML = STATUSES.map(function (status) {
      var cards = list.filter(function (w) { return w.status === status; });
      return '<section class="col"><h3><span>' + status + '</span><span>' + cards.length + '</span></h3>' +
        (cards.length ? cards.map(function (w) {
          return '<article class="item ' + (w.defect ? "overdue" : "") + '" onclick="QXPage.showDetail(\'' + w.id + '\')">' +
            '<b>' + esc(w.theme) + '</b>' +
            '<div class="meta">' + esc(w.base) + " · " + esc(w.line) + "<br>" +
            "进度 " + w.progress + "% · 阴干 " + esc(w.dryDate) + "<br>" +
            "金粉：" + esc(w.gold) + " · 交付：" + esc(w.delivery) + "<br>" +
            "缺陷：" + esc(w.defect || "无") + '</div>' +
            '<div class="order-box" onclick="event.stopPropagation()">' + orderBlock(w) + '</div>' +
            '<div class="card-actions" onclick="event.stopPropagation()">' +
            STATUSES.map(function (st) {
              return '<button class="' + (st === status ? "secondary" : "") + ' mini-btn" ' +
                'onclick="QXPage.setStatus(\'' + w.id + '\',\'' + st + '\')">' + st + '</button>';
            }).join("") +
            '<button class="warn mini-btn" onclick="QXPage.defectDialog(\'' + w.id + '\')">记缺陷</button>' +
            '<button class="secondary mini-btn" onclick="QXPage.correctDialog(\'' + w.id + '\')">胎体/纹样修正</button>' +
            '</div></article>';
        }).join("") : '<div class="empty">暂无作品</div>') +
        '</section>';
    }).join("");
  }

  function renderSummaries() {
    var today = new Date().toISOString().slice(0, 10);
    var todayDry = s.works.filter(function (w) { return w.dryDate <= today && w.status === "待阴干"; });
    var defects = s.works.filter(function (w) { return w.defect; });
    var deliveries = s.works.slice().sort(function (a, b) {
      return a.delivery.localeCompare(b.delivery);
    }).slice(0, 4);

    el("todayDry").innerHTML = todayDry.length ? todayDry.map(function (w) {
      return '<div class="item" onclick="QXPage.showDetail(\'' + w.id + '\')"><b>' + esc(w.theme) +
        '</b><div class="meta">' + esc(w.base) + " · " + esc(w.dryDate) + '</div></div>';
    }).join("") : '<div class="empty">暂无</div>';

    el("defectList").innerHTML = defects.length ? defects.map(function (w) {
      return '<div class="item overdue" onclick="QXPage.showDetail(\'' + w.id + '\')"><b>' + esc(w.theme) +
        '</b><div class="meta">' + esc(w.defect) + '</div></div>';
    }).join("") : '<div class="empty">暂无</div>';

    el("deliveryList").innerHTML = deliveries.map(function (w) {
      return '<div class="item" onclick="QXPage.showDetail(\'' + w.id + '\')"><b>' + esc(w.theme) +
        '</b><div class="meta">' + esc(w.delivery) + " · " + esc(w.status) + '</div></div>';
    }).join("") || '<div class="empty">暂无</div>';
  }

  function renderHistory() {
    el("historyList").innerHTML = s.history.slice(0, 40).map(function (h) {
      return '<div class="hist ' + esc(h.type) + '"><span class="dot"></span>' +
        '<div><div>' + esc(h.text) + '</div>' +
        '<div class="meta">' + new Date(h.at).toLocaleString() + '</div></div></div>';
    }).join("");
  }

  function render() {
    renderBatches();
    renderSlots();
    renderSummaries();
    renderBoard();
    renderHistory();
  }

  /* ---------- 交互：作品 ---------- */

  el("workForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var data = {};
    new FormData(e.target).forEach(function (v, k) { data[k] = v; });
    tryRun(function () {
      Store.addWork(data);
      e.target.reset();
      var today = new Date().toISOString().slice(0, 10);
      e.target.dryDate.value = today;
      e.target.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
      toast("作品已加入工坊", true);
    });
  });

  function setStatus(id, status) {
    tryRun(function () { Store.updateStatus(id, status); });
  }

  function defectDialog(id) {
    formDialog("记录缺陷",
      '<label>断线/翘线位置<input name="text" required placeholder="右下花瓣断线"></label>',
      "保存缺陷",
      function (data) {
        Store.recordDefect(id, data.text);
        closeDialog();
        toast("缺陷已记录", true);
      });
  }

  function correctDialog(id) {
    var w = Store.getWork(id);
    formDialog("胎体 / 纹样修正（准入失效，按新值重算）",
      '<label>胎体材质<input name="base" required value="' + esc(w.base) + '"></label>' +
      '<label>纹样主题<input name="theme" required value="' + esc(w.theme) + '"></label>' +
      '<div class="form-warn">保存后：已准入的单据作废并退回待阴干；未结束单据清空初称/称重，占柜单据继续占位重测。</div>',
      "保存修正",
      function (data) {
        Store.correctWork(id, { base: data.base, theme: data.theme });
        closeDialog();
        toast("已修正，准入结果按新值重算", true);
      });
  }

  function showDetail(id) {
    var w = Store.getWork(id);
    var o = latestOrder(id);
    var body =
      '<div class="meta">胎体材质：' + esc(w.base) + "<br>线条：" + esc(w.line) +
      " · 进度 " + w.progress + "%<br>阴干：" + esc(w.dryDate) +
      " · 交付：" + esc(w.delivery) + "<br>金粉：" + esc(w.gold) +
      " · 状态：" + esc(w.status) + "<br>缺陷：" + esc(w.defect || "无") +
      "<br>备注：" + esc(w.note || "无") + '</div>';
    if (o) {
      var b = Store.getBatch(o.batchId);
      body += '<h4 class="dlg-h">补灰单 ' + esc(b ? b.code : "?") + "</h4>" +
        '<div class="timeline">' + o.events.map(function (ev) {
          return '<div class="tl"><span class="meta">' + new Date(ev.at).toLocaleString() +
            '</span> ' + esc(ev.text) + '</div>';
        }).join("") + '</div>';
    }
    openDialog(w.theme + " · " + w.base, body, [
      { label: "关闭", cls: "secondary", onClick: closeDialog }
    ]);
  }

  /* ---------- 交互：批次 ---------- */

  function batchFields(b) {
    b = b || {};
    return '<label>批次编号<input name="code" required value="' + esc(b.code || "") + '" placeholder="PH-2609-A"></label>' +
      '<label>灰料配比<input name="ash" value="' + esc(b.ash || "") + '" placeholder="瓦灰砖灰 3:1"></label>' +
      '<label>含水率（%，上限 12%）<input name="moisture" type="number" step="0.1" min="0" required value="' +
        esc(b.moisture != null ? b.moisture : 9) + '"></label>' +
      '<label class="check"><input name="active" type="checkbox" ' + (b.active !== false ? "checked" : "") +
        '> 批次启用（停用后不得占阴干位）</label>';
  }

  function editBatch(id) {
    var b = id ? Store.getBatch(id) : null;
    formDialog(b ? "编辑补灰批次" : "新增补灰批次", batchFields(b), "保存", function (data) {
      Store.saveBatch({
        id: id, code: data.code, ash: data.ash,
        moisture: Number(data.moisture), active: !!data.__active
      });
      closeDialog();
      toast("批次已保存", true);
    });
  }

  /* ---------- 交互：补灰单 ---------- */

  function openOrderDialog(workId) {
    var existing = Store.openOrderOf(workId);
    if (existing) {
      toast("该作品已有一张未结束补灰单，沿用首次单据", true);
      showOrderDetail(existing.id);
      return;
    }
    var options = s.batches.map(function (b) {
      var hot = !(Number(b.moisture) <= R.RULES.MOISTURE_LIMIT);
      var dis = b.active === false || hot;
      return '<option value="' + b.id + '" ' + (dis ? "disabled" : "") + '>' +
        esc(b.code) + " · " + Number(b.moisture).toFixed(1) + "% · " +
        (b.active === false ? "已停用" : hot ? "含水率超12%" : "可占位") + '</option>';
    }).join("");

    formDialog("开补灰单（每件作品仅一张未结束单）",
      '<label>补灰批次<select name="batchId">' + options + '</select></label>' +
      '<label>补灰原因<input name="reason" placeholder="盘口批缝开裂"></label>' +
      '<div class="grid2">' +
      '<label>修补人<input name="repairer" required placeholder="陈师傅"></label>' +
      '<label>初称重量（克）<input name="baseWeight" type="number" step="0.01" min="0.01" required placeholder="320.00"></label>' +
      '</div>' +
      '<label>修补完成时间（初称计时起点）<input name="repairedAt" type="datetime-local" required value="' +
        datetimeLocalValue() + '"></label>' +
      '<div class="form-warn">批次停用或含水率超过 12% 不能选择；初称后须换人、满 24 小时再称重。</div>',
      "开单并登记初称",
      function (data) {
        var res = Store.openRepairOrder({
          workId: workId, batchId: data.batchId, reason: data.reason,
          repairer: data.repairer, baseWeight: data.baseWeight,
          repairedAt: new Date(data.repairedAt).toISOString()
        });
        closeDialog();
        toast(res.reused ? "已存在未结束单，沿用首次结果" : "补灰单已开立（未结束）", true);
      });
  }

  function occupyDialog(orderId) {
    var free = Store.freeSlots();
    if (!free.length) {
      toast("没有空闲阴干柜位", false);
      return;
    }
    var options = free.map(function (sl) {
      return '<option value="' + sl.id + '">' + esc(sl.code) + "（空柜位）</option>";
    }).join("");
    formDialog("占用阴干柜位",
      '<label>柜位<select name="slotId">' + options + '</select></label>' +
      '<div class="form-warn">仅批次启用且含水率 ≤ 12% 时允许占位；重复占位沿用首次结果。</div>',
      "确认占位",
      function (data) {
        var res = Store.occupySlot(orderId, data.slotId);
        closeDialog();
        toast(res.reused ? "已在占位中，沿用首次结果" : "已占阴干位", true);
      });
  }

  function weighDialog(orderId) {
    var order = s.orders.find(function (o) { return o.id === orderId; });
    var n = order.weighings.length + 1;
    var prevAt = order.weighings.length
      ? order.weighings[order.weighings.length - 1].at
      : order.repairedAt;
    var earliest = prevAt + R.RULES.WEIGH_GAP_MS;
    var canNow = Date.now() >= earliest;
    formDialog("第 " + n + " 次换人称重",
      '<label>称重人（不能是修补人 ' + esc(order.repairer) + '）' +
        '<input name="person" required placeholder="林师傅"></label>' +
      '<div class="grid2">' +
      '<label>称重时间<input name="at" type="datetime-local" required value="' +
        datetimeLocalValue(new Date(Math.max(Date.now(), earliest))) + '"></label>' +
      '<label>重量（克）<input name="weight" type="number" step="0.01" min="0.01" required></label>' +
      '</div>' +
      '<div class="form-warn">须换人，且距' + (n === 1 ? "初称" : "上一次称重") + "满 24 小时" +
        "（最早 " + new Date(earliest).toLocaleString() + "）。当前" + (canNow ? "已满足时间要求。" : "尚未到时间，可先预约录入时间。") +
        "<br>两段失重比例都须落在 0.200%–0.600%。</div>",
      "提交称重",
      function (data) {
        Store.addWeighing(orderId, {
          person: data.person, weight: data.weight,
          at: new Date(data.at).toISOString()
        });
        closeDialog();
        toast("称重已登记", true);
      });
  }

  function seamDialog(orderId) {
    var order = s.orders.find(function (o) { return o.id === orderId; });
    if (order.seamClosed) {
      tryRun(function () { Store.setSeam(orderId, false, ""); toast("已撤销批缝闭合标记", true); });
      return;
    }
    formDialog("确认批缝闭合",
      '<label>确认人<input name="checker" required placeholder="林师傅"></label>',
      "确认闭合",
      function (data) {
        Store.setSeam(orderId, true, data.checker);
        closeDialog();
        toast("批缝已确认闭合", true);
      });
  }

  function admit(orderId) {
    Store.requestAdmission(orderId).then(function (dec) {
      render();
      if (dec.passed) toast("准入通过：进入金粉工序，柜位已释放", true);
      else toast("准入未通过，继续占阴干位" + (dec.reused ? "（沿用首次判定）" : ""), false);
    });
  }

  function closeOrderDialog(orderId) {
    formDialog("结束补灰单（未准入金粉，将释放柜位）",
      '<label>结束说明<input name="note" placeholder="另作返工处理"></label>',
      "结束单据",
      function (data) {
        Store.closeOrder(orderId, data.note);
        closeDialog();
        toast("补灰单已结束", true);
      });
  }

  function showOrderDetail(orderId) {
    var o = s.orders.find(function (x) { return x.id === orderId; });
    var w = Store.getWork(o.workId);
    var b = Store.getBatch(o.batchId);
    var ratios = weighingRatios(o);
    var body =
      '<div class="meta">作品：' + esc(w.theme) + "（" + esc(w.base) + "）<br>" +
      "批次：" + esc(b.code) + " · 含水率 " + Number(b.moisture).toFixed(1) + "%<br>" +
      "状态：" + (ORDER_BADGE[o.status] || [""])[0] +
      (o.slotId ? " · " + esc(Store.getSlot(o.slotId).code) : "") + "<br>" +
      "初称：" + (o.baseWeight ? o.baseWeight.toFixed(2) + "g（" + esc(o.repairer) + "）" : "已清空") + "<br>" +
      "两次失重：" + ratios.map(function (r) { return R.formatPercent(r); }).join(" / ") + "<br>" +
      "批缝：" + (o.seamClosed ? "已闭合（" + esc(o.seamChecker) + "）" : "未闭合") + "</div>" +
      '<div class="timeline">' + o.events.map(function (ev) {
        return '<div class="tl"><span class="meta">' + new Date(ev.at).toLocaleString() +
          '</span> ' + esc(ev.text) + '</div>';
      }).join("") + '</div>';
    openDialog("补灰单履历", body, [{ label: "关闭", cls: "secondary", onClick: closeDialog }]);
  }

  /* ---------- 其余绑定 ---------- */

  el("addBatchBtn").addEventListener("click", function () { editBatch(null); });
  el("clearFilters").addEventListener("click", function () {
    el("themeFilter").value = "";
    el("statusFilter").value = "";
    render();
  });
  [el("statusFilter"), el("themeFilter"), el("sortMode")].forEach(function (e) {
    e.addEventListener("input", render);
  });
  el("exportBtn").addEventListener("click", function () {
    var blob = new Blob([Store.exportJSON()], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "qx-repair-console.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  el("statusFilter").innerHTML =
    '<option value="">全部状态</option>' + STATUSES.map(function (st) { return "<option>" + st + "</option>"; }).join("");

  window.QXPage = {
    setStatus: setStatus,
    defectDialog: defectDialog,
    correctDialog: correctDialog,
    showDetail: showDetail,
    editBatch: editBatch,
    openOrderDialog: openOrderDialog,
    occupyDialog: occupyDialog,
    weighDialog: weighDialog,
    seamDialog: seamDialog,
    admit: admit,
    closeOrderDialog: closeOrderDialog,
    showOrderDetail: showOrderDetail
  };

  render();
})();
