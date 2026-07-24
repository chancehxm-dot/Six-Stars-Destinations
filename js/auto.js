/**
 * auto.js - 通用自动跳转功能 v3
 *
 * 改进:
 * 1. 多站点支持 — 任何 c= 参数值均可激活，使用站点配置区分不同网站
 * 2. 模糊匹配 — 用正则/关键词匹配非广告页面，不再依赖精确文件名
 * 3. 通用页面类型检测 — 基于 URL 模式分析，不依赖特定 JS 对象(window.royalroad 等)
 * 4. 新跳转流程 — 基于URL深度自动深入浏览：每层优先找更深一级链接，无更深链接回首页循环
 * 5. API集成 — deeppage 为白名单机制：首次激活时请求远端配置，只有 c= 值
 *    匹配到 deeppage[n].c 的渠道才开启自动跳转，并使用其 min/max/jump_layers
 *
 * 激活方式: URL 带 ?c=任意值 即可激活，不同值可对应不同站点配置
 * 状态通过 sessionStorage 持久化，浏览器关闭后自动清除
 *
 * API 端点: /{域名首字母}.json?ver=2.0
 * 返回 deeppage 数组，匹配 c 参数后:
 *   - min/max: 页面停留时间(秒)，覆盖默认的页面类型延时
 *   - jump_layers: 最大跳转层数，达到后停止自动跳转
 */
(function () {
  'use strict';

  var STORAGE_KEY = '_ar_state';
  var PARAM_NAME = 'c';

  // ================================================================
  // 非广告页面模糊匹配关键词（不区分大小写）
  // 文件名或路径包含这些关键词即判定为非广告页面，自动跳过
  // ================================================================
  var NON_AD_KEYWORDS = [
    'privacy', 'policy', 'policies',
    'terms', 'tos', 'cookie',
    'dmca', 'contact', 'about',
    'disclaimer', 'agreement', 'copyright',
    'faq', 'support', 'login',
    'register', 'signup', 'signin',
    'knowledgebase', 'help', 'legal',
    'accessibility', 'sitemap', 'robots',
    'gdpr', 'ccpa', 'data-protection',
    'impressum', 'imprint'
  ];

  // ================================================================
  // 站点配置 — 通过 c= 参数值匹配
  // 未匹配到的值自动使用 'default' 配置
  // 每个站点可自定义 URL 匹配的正则表达式
  // ================================================================
  var SITE_CONFIGS = {

    // ---- 默认通用配置 ----
    'default': {
      // 首页 URL 匹配（用于识别首页以便重置深度计数）
      homePatterns: [
        /^\/?$/,
        /^\/?index\.html?$/i,
        /^\/?home\.html?$/i
      ]
    }

    // ---- 示例: 可扩展更多站点配置 ----
    // 'SomeOtherSite': {
    //   homePatterns: [ ... ]
    // }
  };

  // ================================================================
  // 辅助函数
  // ================================================================
  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function getParams() {
    var qs = window.location.search.substring(1);
    var result = {};
    if (!qs) return result;
    var pairs = qs.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      if (kv.length === 2) {
        try {
          result[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
        } catch (e) {
          result[kv[0]] = kv[1];
        }
      }
    }
    return result;
  }

  function getState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function saveState(state) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  // ================================================================
  // API 配置获取 (deeppage)
  // ================================================================

  /** 构建 API 端点 URL: /{域名首字母}.json?ver=2.0 */
  function getConfigEndpoint() {
    var domain = window.location.hostname.replace('www.', '').split('.')[0] || 'default';
    return window.location.origin + '/' + domain.substring(0, 1) + '.json?ver=2.0&_tbLimit=' + Date.now();
  }

  /**
   * 从远端获取配置 JSON
   * @param {Function} callback - function(err, data)
   */
  function fetchApiConfig(callback) {
    var xhr = new XMLHttpRequest();
    var url = getConfigEndpoint();
    xhr.open('GET', url, true);
    xhr.timeout = 5000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            callback(null, data);
          } catch (e) {
            callback(e, null);
          }
        } else {
          callback(new Error('HTTP ' + xhr.status), null);
        }
      }
    };
    xhr.onerror = function () {
      callback(new Error('Network error'), null);
    };
    xhr.ontimeout = function () {
      callback(new Error('Timeout'), null);
    };
    xhr.send();
  }

  /**
   * 在 deeppage 数组中按 c 值匹配配置
   * @param {Object} data - API 返回的完整 JSON
   * @param {string} cValue - URL 中的 c 参数值
   * @returns {Object|null} 匹配的 deeppage 配置项，未匹配返回 null
   */
  function findDeepPageConfig(data, cValue) {
    if (!data || !data.deeppage || !data.deeppage.length) return null;
    for (var i = 0; i < data.deeppage.length; i++) {
      if (data.deeppage[i].c === cValue) {
        return data.deeppage[i];
      }
    }
    return null;
  }

  // ================================================================
  // URL 工具
  // ================================================================

  /** 获取当前页面的 pathname */
  function getPathname() {
    return window.location.pathname || '/';
  }

  /**
   * 将相对 URL 解析为绝对路径形式
   * 例如 '../page.html' + 当前 '/dir/sub/' → '/dir/page.html'
   */
  function resolveUrl(url) {
    if (!url) return '';
    // 已经是绝对 URL
    if (/^https?:\/\//i.test(url)) return url;
    // 已经是根路径
    if (url.charAt(0) === '/') return url;
    // 去掉 ./ 前缀
    if (url.indexOf('./') === 0) url = url.substring(2);

    var base = getPathname();
    // 处理 ../ 回退
    if (url.indexOf('../') === 0) {
      var parts = base.split('/');
      parts.pop(); // 移除当前文件名（或空段）
      while (url.indexOf('../') === 0) {
        parts.pop();
        url = url.substring(3);
      }
      var resolved = parts.join('/');
      if (resolved.charAt(resolved.length - 1) !== '/') resolved += '/';
      return resolved + url;
    }
    // 同级相对路径: 当前目录 + 相对路径
    var dir = base.substring(0, base.lastIndexOf('/') + 1);
    return dir + url;
  }

  /** 从 URL 中提取文件名（去掉路径、hash、query） */
  function extractFilename(url) {
    if (!url) return '';
    var path = url;
    // 处理完整 URL (http://...)
    if (/^https?:\/\//i.test(url)) {
      var tmp = document.createElement('a');
      tmp.href = url;
      path = tmp.pathname;
    }
    // 去掉末尾斜杠
    path = path.replace(/\/+$/, '');
    // 取最后一段
    var parts = path.split('/');
    var filename = parts[parts.length - 1] || parts[parts.length - 2] || '';
    // 去掉 hash 和 query
    filename = filename.split('#')[0].split('?')[0];
    return filename;
  }

  /** 从 URL 中提取纯路径部分（去掉协议、域名、hash、query） */
  function extractPath(url) {
    if (!url) return '';
    var path = url;
    if (/^https?:\/\//i.test(path)) {
      var a = document.createElement('a');
      a.href = path;
      path = a.pathname;
    }
    // 如果不是以 / 开头，说明是相对路径，需要拼接
    if (path.charAt(0) !== '/') {
      path = resolveUrl(path);
      if (/^https?:\/\//i.test(path)) {
        var b = document.createElement('a');
        b.href = path;
        path = b.pathname;
      }
    }
    path = path.split('#')[0].split('?')[0];
    return path;
  }

  // ================================================================
  // 模糊匹配核心
  // ================================================================

  /** 检查字符串是否匹配任一正则表达式 */
  function matchAnyPattern(str, patterns) {
    if (!str) return false;
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(str)) return true;
    }
    return false;
  }

  /** 检查字符串是否包含任一关键词（不区分大小写） */
  function containsAnyKeyword(str, keywords) {
    if (!str) return false;
    var lower = str.toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
      if (lower.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
  }

  // ================================================================
  // 非广告页面检测（模糊匹配）
  // ================================================================

  /**
   * 判断 URL 是否为非广告页面
   * 通过模糊匹配文件名和路径中的关键词来识别
   */
  function isNonAdPage(url) {
    if (!url) return true;

    // 外部链接 → 跳过
    if (/^https?:\/\//i.test(url) && url.indexOf(window.location.hostname) === -1) {
      return true;
    }

    // javascript: / mailto: / tel: / ftp: → 跳过
    if (url.charAt(0) === '#') return true;
    if (/^(javascript|mailto|tel|ftp):/i.test(url)) return true;

    // 提取路径和文件名
    var path = extractPath(url);
    var filename = extractFilename(url);

    // 检查文件名是否包含非广告关键词
    if (filename && containsAnyKeyword(filename, NON_AD_KEYWORDS)) return true;

    // 检查完整路径是否包含非广告关键词
    // (处理无扩展名的路由型 URL，如 /privacy, /terms-of-service 等)
    if (path && containsAnyKeyword(path, NON_AD_KEYWORDS)) return true;

    // 检查路径中的每个目录段
    if (path) {
      var segments = path.replace(/\/+$/, '').split('/');
      for (var i = 0; i < segments.length; i++) {
        if (segments[i] && containsAnyKeyword(segments[i], NON_AD_KEYWORDS)) return true;
      }
    }

    return false;
  }

  // ================================================================
  // 页面深度检测（基于 URL 路径段数，任何网站通用）
  // ================================================================

  var currentSite = 'default';

  /** 获取当前站点配置 */
  function getConfig() {
    if (SITE_CONFIGS[currentSite]) return SITE_CONFIGS[currentSite];
    return SITE_CONFIGS['default'];
  }

  /**
   * 计算当前页面的 URL 深度
   * depth 0: 首页（/ 或 /index.html）
   * depth 1: /xxx
   * depth 2: /xxx/yyy
   * depth 3+: 更深层页面
   */
  function getPageDepth() {
    var pathname = getPathname();
    var config = getConfig();

    // 首页检测
    if (matchAnyPattern(pathname, config.homePatterns)) return 0;

    var cleanPath = pathname.replace(/\/+$/, '').replace(/^\//, '');
    if (!cleanPath) return 0;
    return cleanPath.split('/').length;
  }

  /** 计算指定 href 链接的 URL 深度 */
  function getLinkDepth(href) {
    var path = extractPath(href);
    var config = getConfig();
    if (matchAnyPattern(path, config.homePatterns)) return 0;
    var cleanPath = path.replace(/\/+$/, '').replace(/^\//, '');
    if (!cleanPath) return 0;
    return cleanPath.split('/').length;
  }

  /**
   * 根据 API 配置或页面深度返回停留时间（毫秒）
   * @param {Object|null} deepPageConfig - API 返回的 deeppage 匹配项
   */
  function getDelay(deepPageConfig) {
    // 优先使用 API 配置的 min/max（秒 → 毫秒）
    if (deepPageConfig && deepPageConfig.min !== undefined && deepPageConfig.max !== undefined) {
      var minMs = Number(deepPageConfig.min) * 1000;
      var maxMs = Number(deepPageConfig.max) * 1000;
      if (minMs > 0 && maxMs >= minMs) {
        return randomInt(minMs, maxMs);
      }
    }

    // 回退：页面越深停留越短
    var depth = getPageDepth();
    if (depth === 0) return randomInt(20000, 30000);
    if (depth === 1) return randomInt(15000, 25000);
    if (depth === 2) return randomInt(10000, 18000);
    return randomInt(6000, 12000);
  }

  // ================================================================
  // 链接收集
  // ================================================================

  /**
   * 收集页面中所有有效链接（排除外部、非广告、自引用）
   */
  function collectLinks() {
    var links = document.getElementsByTagName('a');
    var result = [];
    var currentPath = getPathname();

    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      if (!href) continue;
      if (href.charAt(0) === '#') continue;
      if (href.indexOf('javascript:') === 0) continue;
      if (/^(mailto|tel|ftp):/i.test(href)) continue;

      // 模糊匹配非广告页面 → 跳过
      if (isNonAdPage(href)) continue;

      // 跳过指向当前页面自身的链接
      var linkPath = extractPath(href);
      if (linkPath && linkPath === currentPath) continue;

      result.push(href);
    }
    return result;
  }

  /** 链接去重（按文件名） */
  function uniqueLinks(links) {
    var seen = {};
    var result = [];
    for (var i = 0; i < links.length; i++) {
      var key = extractFilename(links[i]);
      if (!key) key = extractPath(links[i]); // fallback: 完整路径
      if (!seen[key]) {
        seen[key] = true;
        result.push(links[i]);
      }
    }
    return result;
  }

  // ================================================================
  // 跳转策略：URL深度驱动 — 优先找更深链接，无更深则回首页（任何网站通用）
  // ================================================================

  /**
   * 根据当前页面深度确定下一个跳转目标
   *
   * 每次跳转优先选比当前深一级的链接，自然实现"首页→一级→二级→三级→…"
   * 没有更深链接说明已到最深页，回首页重新开始循环
   */
  function findNextUrl() {
    var currentDepth = getPageDepth();
    var allLinks = collectLinks();
    var deeper = [];

    // 优先找比当前深度更深的链接（向网站深处探索）
    for (var i = 0; i < allLinks.length; i++) {
      if (getLinkDepth(allLinks[i]) > currentDepth) {
        deeper.push(allLinks[i]);
      }
    }

    if (deeper.length > 0) {
      deeper = uniqueLinks(deeper);
      return deeper[randomInt(0, deeper.length - 1)];
    }

    // 没有更深链接 → 已到最深，回首页重新开始
    return '/index.html';
  }

  // ================================================================
  // 核心跳转逻辑
  // ================================================================

  /**
   * 执行自动跳转（由 init 在获取配置后调用）
   * @param {string} siteKey - URL 中的 c= 参数值
   * @param {Object|null} deepPageConfig - API 匹配的 deeppage 配置，未匹配为 null
   */
  function doAutoJump(siteKey, deepPageConfig) {
    currentSite = siteKey || 'default';

    var existingState = getState();
    var isActive;

    if (!existingState) {
      // 首次访问：有 c= 参数即激活
      isActive = true;
    } else {
      // 已有状态：保持激活
      isActive = existingState.active === true;
    }

    if (!isActive) return;

    // 构建/更新状态
    var state = existingState || {};
    state.active = true;
    if (!state.startTime) state.startTime = Date.now();
    state.visitedCount = (state.visitedCount || 0) + 1;
    state.site = currentSite;
    state.pageDepth = getPageDepth();
    state.lastUrl = getPathname();

    // 将 deepPageConfig 持久化到状态中，后续页面直接使用，无需重复请求 API
    if (deepPageConfig) {
      state.deepPageConfig = deepPageConfig;
    } else if (!state.deepPageConfig) {
      // 首次未匹配到，后续页面也不再尝试
      state.deepPageConfig = null;
    }

    saveState(state);

    // ---- jump_layers 限制：达到配置的最大跳转层数则停止 ----
    var dpConfig = deepPageConfig || (existingState ? existingState.deepPageConfig : null);
    if (dpConfig && dpConfig.jump_layers !== undefined) {
      var maxLayers = Number(dpConfig.jump_layers);
      if (maxLayers > 0 && state.visitedCount >= maxLayers) {
        // 已达到最大跳转层数，不再继续跳转
        return;
      }
    }

    // ---- 延迟后跳转 ----
    var delay = getDelay(dpConfig);
    var nextUrl = findNextUrl();

    if (nextUrl) {
      setTimeout(function () {
        window.location.href = nextUrl;
      }, delay);
    } else {
      // 找不到合适的跳转目标（页面链接全被过滤），回首页重新开始循环
      setTimeout(function () {
        window.location.href = '/index.html';
      }, delay);
    }
  }

  // ================================================================
  // 主入口
  // ================================================================

  function init() {
    var params = getParams();
    var siteKey = params[PARAM_NAME];

    // 没有 c= 参数 → 检查是否有已激活的会话状态（从上一页跳转过来）
    if (siteKey === undefined) {
      var existingState = getState();
      if (existingState && existingState.active) {
        // 已有活跃会话，从状态中恢复 siteKey 继续跳转链
        doAutoJump(existingState.site || 'default', existingState.deepPageConfig || null);
      }
      return;
    }

    currentSite = siteKey || 'default';

    var existingState = getState();

    // 已有会话状态 → 直接使用存储的 deepPageConfig，无需再次请求 API
    if (existingState) {
      doAutoJump(siteKey, existingState.deepPageConfig || null);
      return;
    }

    // 首次激活 → 请求远端 API 获取 deeppage 配置
    // deeppage 数组是白名单：只有 c 值匹配到 deeppage[n].c 的渠道才开启自动跳转
    fetchApiConfig(function (err, data) {
      var deepPageConfig = null;
      if (!err && data) {
        deepPageConfig = findDeepPageConfig(data, siteKey);
      }
      // API 未匹配到对应 c 值 → 该渠道未开启自动跳转，不激活
      if (!deepPageConfig) return;
      doAutoJump(siteKey, deepPageConfig);
    });
  }

  // ---- 页面加载完成后初始化 ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
