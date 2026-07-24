/**
 * auto1.0.js - Deep Page Auto-Redirect v1.0
 *
 * 深度页面自动跳转脚本 — 远程 API 配置驱动
 *
 * 激活流程:
 *   1. URL 带 ?c=xxx → 请求 API 获取 deeppage 配置 → 匹配 c 值 → 激活
 *   2. 后续页面通过 sessionStorage 维持激活状态 (无需重复带 c 参数)
 *   3. localhost/127.0.0.1 本地开发环境跳过 API, 直接用默认配置激活
 *
 * API 端点:
 *   {origin}/{domain首字母}.json?ver=2.0&_tbLimit={timestamp}
 *   例如: example.com → /e.json,  abc.com → /a.json
 *
 * deeppage 配置项:
 *   - c:           页面所带 c 参数值 (用于匹配)
 *   - min:         停留最短秒数
 *   - max:         停留最长秒数
 *   - jump_layers: 跳转总层数 (达到后停止跳转)
 *
 * 跳转策略 (URL 深度驱动 + 模糊匹配):
 *   Home (depth 0)    → 二级页面 (depth 1)
 *   二级页面 (depth 1) → 标签/内容页面 (depth 2+)
 *   标签/内容页        → 继续随机游走
 *
 * 核心特性:
 *   - 模糊匹配非内容页面 (不硬编码文件名, 换模板也能用)
 *   - URL 路径段数计算深度 (不依赖特定 CMS 路由)
 *   - 排除上一页防止 A↔B 回弹
 *   - 无可用链接时回首页兜底
 *   - deeppage 层数上限 + min/max 停留时间由 API 动态配置
 *   - 完整 API 响应 (recaptcha/clickblock/adlimit/pkgonly) 暴露给其他脚本
 */
(function () {
  'use strict';

  // ================================================================
  // 常量
  // ================================================================

  var STORAGE_KEY = '_ar_state';
  var CONFIG_CACHE_KEY = '_ar_config';
  var PARAM_NAME = 'c';

  // 默认配置 (API 不可用时的后备, 单位: 秒)
  var DEFAULT_MIN_STAY = 10;
  var DEFAULT_MAX_STAY = 25;
  var DEFAULT_JUMP_LAYERS = 8;

  // ================================================================
  // 模糊匹配: 非内容/法律页面关键词
  // 不依赖精确文件名, 换任何模板都有效
  // ================================================================

  var NON_CONTENT_URL_PATTERNS = [
    // 法律/政策页
    'privacy', 'privacy-policy', 'privacypolicy', 'privacy_policy',
    'terms', 'terms-of-service', 'terms-of-use', 'termsofservice', 'termsofuse',
    'tos', 'eula',
    'disclaimer', 'disclaimers',
    'dmca', 'copyright', 'copyright-notice', 'copyrightnotice',
    'cookie', 'cookie-policy', 'cookiepolicy', 'cookie_policy',
    'gdpr', 'ccpa',
    'agreement', 'user-agreement', 'useragreement',
    'policy', 'policies', 'legal',
    // 联系/关于页
    'contact', 'contact-us', 'contactus', 'contact_us',
    'about', 'about-us', 'aboutus', 'about_us',
    // 登录/注册页
    'login', 'log-in', 'log_in', 'signin', 'sign-in', 'sign_in',
    'signup', 'sign-up', 'sign_up', 'register', 'registration',
    'logout', 'log-out', 'log_out',
    // 搜索/帮助页
    'search', 'faq', 'faqs', 'help', 'support', 'customer-service',
    'knowledge', 'knowledge-base', 'knowledgebase', 'knowledge_base',
    // 其他非内容页
    'sitemap', 'site-map',
    'robots',
    'accessibility',
    'error', '404', '500',
    'author-dashboard', 'dashboard',
    'member', 'members', 'memberlist', 'membership',
    'profile', 'profiles', 'user', 'users',
    'forum', 'forums', 'forumdisplay',
    'rss', 'feed', 'atom',
    'random'
  ];

  var NON_CONTENT_TEXT_KEYWORDS = [
    'privacy policy', 'privacy',
    'terms of service', 'terms of use', 'terms & conditions', 'terms and conditions',
    'terms', 'tos',
    'contact us', 'contact',
    'about us', 'about',
    'dmca', 'copyright',
    'cookie policy', 'cookies',
    'disclaimer',
    'login', 'log in', 'sign in', 'signin',
    'register', 'sign up', 'signup',
    'search', 'faq', 'help', 'support',
    'sitemap', 'site map',
    // 中文
    '隐私政策', '隐私协议', '隐私',
    '用户协议', '服务条款', '条款',
    '联系我们', '联系',
    '关于我们', '关于',
    '免责声明', '免责',
    '注册', '登录', '登出',
    '搜索', '帮助', '常见问题'
  ];

  // ================================================================
  // 辅助函数
  // ================================================================

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function getState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { }
    return null;
  }

  function saveState(state) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { }
  }

  // ================================================================
  // API 配置获取
  // ================================================================

  /**
   * 判断是否为本地开发环境
   */
  function isLocalDev() {
    var hn = window.location.hostname;
    return hn === 'localhost' || hn === '127.0.0.1' || hn === '::1';
  }

  /**
   * 构建 API 端点 URL
   * 规则: 去掉 www., 取域名第一段的首字母
   * 例如: www.games.example.com → games.example.com → g → g.json
   *       example.com → example → e → e.json
   */
  function getApiEndpoint() {
    var hostname = window.location.hostname.replace('www.', '');
    var domain = hostname.split('.')[0] || 'default';
    var firstChar = domain.substring(0, 1);
    return window.location.origin + '/' + firstChar + '.json?ver=2.0&_tbLimit=' + Date.now();
  }

  /**
   * 从 sessionStorage 获取缓存的 API 配置
   */
  function getCachedConfig() {
    try {
      var raw = sessionStorage.getItem(CONFIG_CACHE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { }
    return null;
  }

  /**
   * 缓存 API 配置到 sessionStorage
   */
  function cacheConfig(config) {
    try {
      sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
    } catch (e) { }
  }

  /**
   * 加载远程配置
   * 优先级: sessionStorage 缓存 > 本地开发默认 > 远程 API
   *
   * @param {string} cValue - c 参数值
   * @return {object|null} 完整 API 配置对象, 失败返回 null
   */
  function loadConfig(cValue) {
    // 1. sessionStorage 缓存 (同一次会话内复用)
    var cached = getCachedConfig();
    if (cached) return cached;

    // 2. 本地开发环境: 构造默认配置, 跳过 API
    if (isLocalDev()) {
      var devConfig = {
        _local: true,
        recaptcha: null,
        recaptcha_ratio: 0,
        recaptcha_type: '0',
        clickblock: [],
        adlimit: [],
        pkgonly: [],
        deeppage: [{
          c: cValue || 'local',
          min: DEFAULT_MIN_STAY,
          max: DEFAULT_MAX_STAY,
          jump_layers: DEFAULT_JUMP_LAYERS
        }]
      };
      cacheConfig(devConfig);
      window._arConfig = devConfig;
      return devConfig;
    }

    // 3. 请求远程 API (同步, 同一域名的静态 JSON, 响应极快)
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', getApiEndpoint(), false); // false = 同步
      xhr.send();

      if (xhr.status === 200 && xhr.responseText) {
        var config = JSON.parse(xhr.responseText);
        cacheConfig(config);
        // 暴露完整配置给页面其他脚本使用
        window._arConfig = config;
        return config;
      }
    } catch (e) {
      // API 不可用, 回退到 null (由调用方处理)
    }

    return null;
  }

  /**
   * 从 API 配置中查找匹配 c 值的 deeppage 配置
   *
   * @param {object} config - 完整 API 配置
   * @param {string} cValue - c 参数值
   * @return {object|null} 匹配的 deeppage 条目, 未找到返回 null
   */
  function findDeepPageConfig(config, cValue) {
    if (!config || !config.deeppage || !cValue) return null;
    var list = config.deeppage;
    for (var i = 0; i < list.length; i++) {
      if (list[i].c === cValue) {
        return list[i];
      }
    }
    return null;
  }

  // ================================================================
  // URL 工具函数
  // ================================================================

  /**
   * 解析相对 URL 为绝对路径
   */
  function resolveUrl(url) {
    var a = document.createElement('a');
    a.href = url;
    return a.pathname;
  }

  /**
   * 去除 hash 和 query
   */
  function stripExtra(url) {
    var hashIdx = url.indexOf('#');
    if (hashIdx !== -1) url = url.substring(0, hashIdx);
    var qIdx = url.indexOf('?');
    if (qIdx !== -1) url = url.substring(0, qIdx);
    return url;
  }

  /**
   * 从路径中提取文件名
   */
  function extractFilename(path) {
    var clean = stripExtra(path);
    var parts = clean.split('/');
    var last = parts[parts.length - 1];
    if (!last) {
      last = parts[parts.length - 2] || '';
    }
    return last;
  }

  /**
   * 计算 URL 路径深度 (路径段数)
   * /                    → 0
   * /index.html          → 0
   * /category/           → 1
   * /category/page.html  → 1
   * /a/b/c.html          → 2
   */
  function getUrlDepth(url) {
    var resolved = resolveUrl(url);
    var clean = stripExtra(resolved);
    if (clean.charAt(0) === '/') clean = clean.substring(1);
    if (clean.charAt(clean.length - 1) === '/') clean = clean.substring(0, clean.length - 1);
    if (!clean) return 0;
    var parts = clean.split('/');
    var last = parts[parts.length - 1].toLowerCase();
    if (last === 'index.html' || last === 'index.htm' || last === 'index.php' || last === '') {
      return Math.max(0, parts.length - 1);
    }
    return parts.length;
  }

  /**
   * 判断是否为外部链接
   */
  function isExternalLink(url) {
    if (/^https?:\/\//i.test(url)) {
      return url.indexOf(window.location.hostname) === -1;
    }
    if (/^\/\//.test(url)) return true;
    return false;
  }

  /**
   * 判断是否为特殊协议链接 (anchor, javascript, mailto, tel 等)
   */
  function isSpecialLink(url) {
    if (!url) return true;
    if (url.charAt(0) === '#') return true;
    if (url.indexOf('javascript:') === 0) return true;
    if (url.indexOf('mailto:') === 0) return true;
    if (url.indexOf('tel:') === 0) return true;
    if (url.indexOf('data:') === 0) return true;
    return false;
  }

  /**
   * 判断文件扩展名是否为网页文件
   */
  function isWebPage(url) {
    var filename = extractFilename(url);
    if (!filename) return true;
    var extMatch = filename.match(/\.([a-z0-9]+)$/i);
    if (extMatch) {
      var ext = extMatch[1].toLowerCase();
      var webExts = ['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'cfm', 'shtml'];
      if (webExts.indexOf(ext) === -1) return false;
    }
    return true;
  }

  // ================================================================
  // 模糊匹配: 非内容页面检测
  // ================================================================

  function urlContainsNonContentKeyword(url) {
    var urlLower = url.toLowerCase();
    for (var i = 0; i < NON_CONTENT_URL_PATTERNS.length; i++) {
      if (urlLower.indexOf(NON_CONTENT_URL_PATTERNS[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function textContainsNonContentKeyword(text) {
    if (!text) return false;
    var textLower = text.toLowerCase();
    for (var i = 0; i < NON_CONTENT_TEXT_KEYWORDS.length; i++) {
      if (textLower.indexOf(NON_CONTENT_TEXT_KEYWORDS[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function isNonContentLink(url, linkText) {
    if (!url) return true;
    if (isSpecialLink(url)) return true;
    if (isExternalLink(url)) return true;
    if (!isWebPage(url)) return true;
    if (urlContainsNonContentKeyword(url)) return true;
    if (textContainsNonContentKeyword(linkText)) return true;
    return false;
  }

  function isCurrentPageNonContent() {
    var currentPath = window.location.pathname;
    return urlContainsNonContentKeyword(currentPath);
  }

  // ================================================================
  // 链接收集与过滤
  // ================================================================

  function collectAllLinks() {
    var anchors = document.getElementsByTagName('a');
    var links = [];
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href');
      if (!href) continue;
      if (isSpecialLink(href)) continue;
      var text = (anchors[i].textContent || anchors[i].innerText || '').trim();
      if (text.length > 200) text = text.substring(0, 200);
      links.push({ href: href, text: text });
    }
    return links;
  }

  function filterContentLinks(links) {
    var result = [];
    for (var i = 0; i < links.length; i++) {
      if (!isNonContentLink(links[i].href, links[i].text)) {
        result.push(links[i]);
      }
    }
    return result;
  }

  function dedupeLinks(links) {
    var seen = {};
    var result = [];
    for (var i = 0; i < links.length; i++) {
      var path = resolveUrl(links[i].href);
      path = stripExtra(path);
      if (!seen[path]) {
        seen[path] = true;
        result.push(links[i]);
      }
    }
    return result;
  }

  function excludeSelf(links) {
    var currentPath = stripExtra(window.location.pathname);
    var result = [];
    for (var i = 0; i < links.length; i++) {
      var linkPath = stripExtra(resolveUrl(links[i].href));
      if (linkPath !== currentPath) {
        result.push(links[i]);
      }
    }
    return result;
  }

  function excludePreviousPage(links, previousUrl) {
    if (!previousUrl) return links;
    var prevPath = stripExtra(previousUrl);
    var result = [];
    for (var i = 0; i < links.length; i++) {
      var linkPath = stripExtra(resolveUrl(links[i].href));
      if (linkPath !== prevPath) {
        result.push(links[i]);
      }
    }
    if (result.length === 0) return links;
    return result;
  }

  // ================================================================
  // 页面类型判断 (URL 深度驱动, 不依赖特定 CMS)
  // ================================================================

  function isHomePage() {
    var path = window.location.pathname;
    if (path === '/' || path === '') return true;
    var filename = extractFilename(path).toLowerCase();
    if (filename === 'index.html' || filename === 'index.htm' || filename === 'index.php' || filename === '') return true;
    if (getUrlDepth(window.location.href) === 0) return true;
    return false;
  }

  /**
   * 页面层级:
   *   0 = 首页
   *   1 = 二级页面 (分类/列表)
   *   2 = 三级页面 (标签)
   *   3 = 更深页面 (文章/详情)
   */
  function getPageLevel() {
    if (isHomePage()) return 0;
    var depth = getUrlDepth(window.location.href);
    if (depth === 1) return 1;
    if (depth === 2) return 2;
    return 3;
  }

  // ================================================================
  // 跳转策略 (URL 深度驱动)
  // ================================================================

  function prepareCandidates(previousUrl) {
    var allLinks = collectAllLinks();
    var contentLinks = filterContentLinks(allLinks);
    contentLinks = excludeSelf(contentLinks);
    contentLinks = dedupeLinks(contentLinks);
    contentLinks = excludePreviousPage(contentLinks, previousUrl);
    return contentLinks;
  }

  /**
   * 首页 → 随机选一个二级页面 (depth 1)
   */
  function findSecondaryPage(candidates) {
    var depthOne = [];
    var others = [];
    for (var i = 0; i < candidates.length; i++) {
      var d = getUrlDepth(candidates[i].href);
      if (d === 1) {
        depthOne.push(candidates[i]);
      } else if (d > 0) {
        others.push(candidates[i]);
      }
    }
    var pool = depthOne.length > 0 ? depthOne : (others.length > 0 ? others : candidates);
    if (pool.length === 0) return null;
    return pool[randomInt(0, pool.length - 1)];
  }

  /**
   * 二级页面 → 随机选一个标签/内容页面 (depth 2+)
   */
  function findTagOrContentPage(candidates) {
    var currentDepth = getUrlDepth(window.location.href);
    var deeper = [];
    var same = [];
    for (var i = 0; i < candidates.length; i++) {
      var d = getUrlDepth(candidates[i].href);
      if (d > currentDepth) {
        deeper.push(candidates[i]);
      } else if (d >= currentDepth) {
        same.push(candidates[i]);
      }
    }
    var pool = deeper.length > 0 ? deeper : (same.length > 0 ? same : candidates);
    if (pool.length === 0) return null;
    return pool[randomInt(0, pool.length - 1)];
  }

  /**
   * 深层页面 → 继续随机游走
   */
  function findRandomWalk(candidates) {
    if (candidates.length === 0) return null;
    return candidates[randomInt(0, candidates.length - 1)];
  }

  /**
   * 主查找函数: 根据页面层级选择跳转目标
   */
  function findNextUrl(previousUrl) {
    var candidates = prepareCandidates(previousUrl);

    if (candidates.length === 0) {
      return '/index.html';
    }

    var level = getPageLevel();

    if (level === 0) {
      var target = findSecondaryPage(candidates);
      return target ? target.href : '/index.html';
    }

    if (level === 1) {
      var target = findTagOrContentPage(candidates);
      return target ? target.href : '/index.html';
    }

    var target = findRandomWalk(candidates);
    return target ? target.href : '/index.html';
  }

  // ================================================================
  // 延迟策略 (优先使用 API 配置)
  // ================================================================

  function getDelay(dpConfig) {
    // 非内容页面快速跳转
    if (isCurrentPageNonContent()) return randomInt(1500, 3000);

    // API 配置的 min/max (单位: 秒 → 毫秒)
    if (dpConfig && dpConfig.min && dpConfig.max) {
      return randomInt(dpConfig.min * 1000, dpConfig.max * 1000);
    }

    // 内置默认延迟 (API 不可用时)
    var level = getPageLevel();
    if (level === 0) return randomInt(15000, 25000);
    if (level === 1) return randomInt(10000, 20000);
    if (level === 2) return randomInt(8000, 15000);
    return randomInt(5000, 12000);
  }

  // ================================================================
  // URL 参数解析
  // ================================================================

  function parseParams() {
    var qs = window.location.search.substring(1);
    var result = {};
    if (!qs) return result;
    var pairs = qs.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      if (kv.length === 2) {
        result[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
      }
    }
    return result;
  }

  // ================================================================
  // 主入口
  // ================================================================

  function init() {
    var params = parseParams();
    var cValue = params[PARAM_NAME];            // URL 中的 ?c=xxx
    var existingState = getState();             // sessionStorage 中的状态
    var isActive = false;
    var dpConfig = null;                        // 匹配到的 deeppage 条目

    // ---- 情况1: 从 sessionStorage 恢复激活状态 (后续跳转页面) ----
    if (existingState && existingState.active && existingState.dpConfig) {
      isActive = true;
      dpConfig = existingState.dpConfig;
    }

    // ---- 情况2: URL 带 c 参数 → 首次激活 ----
    if (cValue) {
      var apiConfig = loadConfig(cValue);       // 获取 API 配置 (优先缓存)
      if (apiConfig) {
        var matched = findDeepPageConfig(apiConfig, cValue);
        if (matched) {
          isActive = true;
          dpConfig = matched;
        }
      }
    }

    // ---- 未激活 → 不做任何事 ----
    if (!isActive) return;

    // ---- 初始化/更新状态 ----
    var state = existingState || {
      active: true,
      startTime: Date.now(),
      visitedCount: 0,
      visitLog: []
    };

    // 首次激活时写入 dpConfig 和 cValue
    if (cValue && dpConfig) {
      state.active = true;
      state.cValue = cValue;
      state.dpConfig = dpConfig;
      if (!state.startTime) state.startTime = Date.now();
      if (!state.visitedCount) state.visitedCount = 0;
      if (!state.visitLog) state.visitLog = [];
    }

    // ---- 检查跳转层数上限 ----
    var jumpLayers = dpConfig ? (dpConfig.jump_layers || DEFAULT_JUMP_LAYERS) : DEFAULT_JUMP_LAYERS;
    var visitedSoFar = state.visitedCount || 0;

    if (visitedSoFar >= jumpLayers) {
      // 已达层数上限, 停止跳转 (静默退出, 用户留在当前页)
      return;
    }

    // ---- 记录本次访问 ----
    state.visitedCount = visitedSoFar + 1;
    state.lastUrl = window.location.href;
    state.lastPageLevel = getPageLevel();
    state.visitLog = state.visitLog || [];
    state.visitLog.push({
      url: window.location.href,
      level: getPageLevel(),
      layer: state.visitedCount,
      time: Date.now()
    });

    // 只保留最近 20 条记录
    if (state.visitLog.length > 20) {
      state.visitLog = state.visitLog.slice(-20);
    }

    saveState(state);

    // ---- 计算上一页 (用于防回弹) ----
    var previousUrl = null;
    if (state.visitLog.length >= 2) {
      previousUrl = state.visitLog[state.visitLog.length - 2].url;
    }

    // ---- 跳转 ----
    var delay = getDelay(dpConfig);
    var nextUrl = findNextUrl(previousUrl);

    if (nextUrl) {
      setTimeout(function () {
        window.location.href = nextUrl;
      }, delay);
    }
  }

  // ================================================================
  // 启动
  // ================================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
