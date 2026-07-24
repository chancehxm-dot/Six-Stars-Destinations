/**
 * auto1.0.js - Universal Auto-Redirect Script v2.0
 *
 * 通用自动跳转脚本 — 模糊匹配 + URL深度驱动 + 随机游走
 * 适配不同网站模板, 无需修改代码即可在任意网站上运行。
 *
 * 跳转策略 (URL深度驱动):
 *   Home (depth 0)    → 二级页面 (depth 1)
 *   二级页面 (depth 1) → 标签/内容页面 (depth 2+)
 *   标签/内容页 (depth 2+) → 继续随机游走
 *
 * 激活方式: URL 参数 ?c=PRreadwaveM 或 sessionStorage 已有激活状态
 *
 * 核心改进 (v2.0):
 *   - 模糊匹配非内容页面 (不再硬编码文件名, 换模板也能用)
 *   - URL路径段数计算深度 (不依赖特定 CMS 路由)
 *   - 排除上一页防止 A↔B 回弹
 *   - 无可用链接时回首页兜底
 */
(function () {
  'use strict';

  var STORAGE_KEY = '_ar_state';
  var PARAM_NAME = 'c';
  var PARAM_VALUE = 'PRreadwaveM';

  // ================================================================
  // 模糊匹配: 非内容/法律页面关键词
  // 这些关键词用于 ANY 网站模板, 只要 URL 或链接文本包含就跳过
  // ================================================================

  // URL 路径中的非内容关键词 (英文 + 常见模式)
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
    'sitemap', 'site-map', 'sitemap',
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

  // 链接文本中的非内容关键词 (比 URL 检测更宽松, 避免误杀)
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
  // URL 工具函数
  // ================================================================

  /**
   * 解析相对 URL 为绝对路径
   * 利用浏览器 a 标签自动解析相对路径的特性
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
    // 处理完整 URL
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
      // 路径以 / 结尾, 取倒数第二段
      last = parts[parts.length - 2] || '';
    }
    return last;
  }

  /**
   * 计算 URL 路径深度 (路径段数)
   * 例如:
   *   /                    → 0
   *   /index.html          → 0
   *   /category/           → 1
   *   /category/page.html  → 1
   *   /a/b/c.html          → 2
   */
  function getUrlDepth(url) {
    var resolved = resolveUrl(url);
    var clean = stripExtra(resolved);
    // 去掉首尾 /
    if (clean.charAt(0) === '/') clean = clean.substring(1);
    if (clean.charAt(clean.length - 1) === '/') clean = clean.substring(0, clean.length - 1);
    if (!clean) return 0;
    var parts = clean.split('/');
    // index.* 文件不算一层
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
   * 判断文件扩展名是否为网页文件 (html/htm/php/asp/jsp 或 无扩展名)
   */
  function isWebPage(url) {
    var filename = extractFilename(url);
    if (!filename) return true; // 无文件名 = 目录, 可能是网页
    // 有扩展名但不是网页扩展名
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

  /**
   * 检查 URL 是否包含非内容关键词
   */
  function urlContainsNonContentKeyword(url) {
    var urlLower = url.toLowerCase();
    for (var i = 0; i < NON_CONTENT_URL_PATTERNS.length; i++) {
      if (urlLower.indexOf(NON_CONTENT_URL_PATTERNS[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检查链接文本是否包含非内容关键词
   */
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

  /**
   * 综合判断: 该链接是否指向非内容页面?
   * 模糊匹配 URL + 链接文本, 不依赖精确文件名
   */
  function isNonContentLink(url, linkText) {
    if (!url) return true;
    if (isSpecialLink(url)) return true;
    if (isExternalLink(url)) return true;
    if (!isWebPage(url)) return true;

    // 模糊匹配 URL 关键词
    if (urlContainsNonContentKeyword(url)) return true;

    // 模糊匹配链接文本关键词
    if (textContainsNonContentKeyword(linkText)) return true;

    return false;
  }

  /**
   * 判断当前页面是否为非内容页面
   */
  function isCurrentPageNonContent() {
    var currentPath = window.location.pathname;
    return urlContainsNonContentKeyword(currentPath);
  }

  // ================================================================
  // 链接收集
  // ================================================================

  /**
   * 收集页面上所有 <a> 链接
   */
  function collectAllLinks() {
    var anchors = document.getElementsByTagName('a');
    var links = [];
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href');
      if (!href) continue;
      if (isSpecialLink(href)) continue;
      var text = (anchors[i].textContent || anchors[i].innerText || '').trim();
      // 截断过长的文本 (可能是嵌套了子元素)
      if (text.length > 200) text = text.substring(0, 200);
      links.push({ href: href, text: text });
    }
    return links;
  }

  /**
   * 过滤: 只保留内容链接 (排除法律/联系/登录等非内容页)
   */
  function filterContentLinks(links) {
    var result = [];
    for (var i = 0; i < links.length; i++) {
      if (!isNonContentLink(links[i].href, links[i].text)) {
        result.push(links[i]);
      }
    }
    return result;
  }

  /**
   * 去重: 按解析后的路径去重
   */
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

  /**
   * 排除当前页面自身
   */
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

  /**
   * 排除上一页 URL (防止 A↔B 回弹)
   */
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
    // 如果排除上一页后没链接了, 退回不排除
    if (result.length === 0) return links;
    return result;
  }

  // ================================================================
  // 页面类型判断 (URL 深度驱动, 不依赖特定 CMS)
  // ================================================================

  /**
   * 判断是否为首页
   */
  function isHomePage() {
    var path = window.location.pathname;
    if (path === '/' || path === '') return true;
    var filename = extractFilename(path).toLowerCase();
    if (filename === 'index.html' || filename === 'index.htm' || filename === 'index.php' || filename === '') return true;
    // 深度为 0 也视为首页
    if (getUrlDepth(window.location.href) === 0) return true;
    return false;
  }

  /**
   * 页面层级:
   *   0 = 首页
   *   1 = 二级页面 (分类/列表)
   *   2 = 三级页面 (标签)
   *   3+ = 更深页面 (文章/详情)
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

  /**
   * 准备候选链接: 收集 → 过滤 → 去重 → 排除自身 → 排除上一页
   */
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
    // 优先 depth === 1 的链接
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
    // 优先更深层级
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
      // 无可用链接 → 回首页
      return '/index.html';
    }

    var level = getPageLevel();

    if (level === 0) {
      // 首页 → 二级页面
      var target = findSecondaryPage(candidates);
      return target ? target.href : '/index.html';
    }

    if (level === 1) {
      // 二级页面 → 标签/内容页面
      var target = findTagOrContentPage(candidates);
      return target ? target.href : '/index.html';
    }

    // 深层页面 → 随机游走
    var target = findRandomWalk(candidates);
    return target ? target.href : '/index.html';
  }

  // ================================================================
  // 延迟策略
  // ================================================================

  function getDelay() {
    // 非内容页面快速跳转
    if (isCurrentPageNonContent()) return randomInt(1500, 3000);

    var level = getPageLevel();
    if (level === 0) return randomInt(15000, 25000);   // 首页: 15-25s
    if (level === 1) return randomInt(10000, 20000);   // 二级: 10-20s
    if (level === 2) return randomInt(8000, 15000);    // 标签: 8-15s
    return randomInt(5000, 12000);                      // 深层: 5-12s
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
    var activatedByParam = params[PARAM_NAME] === PARAM_VALUE;
    var existingState = getState();
    var isActive = activatedByParam || (existingState && existingState.active);

    if (!isActive) return;

    // 初始化/更新状态
    var state = existingState || {
      active: true,
      startTime: Date.now(),
      visitedCount: 0,
      visitLog: []
    };

    if (activatedByParam) {
      state.active = true;
      if (!state.startTime) state.startTime = Date.now();
      if (!state.visitedCount) state.visitedCount = 0;
      if (!state.visitLog) state.visitLog = [];
    }

    // 记录当前访问
    state.visitedCount = (state.visitedCount || 0) + 1;
    state.lastUrl = window.location.href;
    state.lastPageLevel = getPageLevel();
    state.visitLog = state.visitLog || [];
    state.visitLog.push({
      url: window.location.href,
      level: getPageLevel(),
      time: Date.now()
    });

    // 只保留最近 20 条记录
    if (state.visitLog.length > 20) {
      state.visitLog = state.visitLog.slice(-20);
    }

    // 上一页 URL (用于排除)
    var previousUrl = null;
    if (state.visitLog.length >= 2) {
      previousUrl = state.visitLog[state.visitLog.length - 2].url;
    }

    saveState(state);

    // 计算延迟和下一跳
    var delay = getDelay();
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
