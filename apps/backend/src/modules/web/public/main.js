const API_BASE = window.location.origin;
const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";
const CLIENT_TOKEN_KEY = "seedbox_client_token";
const AUTH_SESSION_KEY = "seedbox_auth_session_v1";
const AUTH_EMAIL_KEY = "seedbox_auth_email";
const FILTER_KEY = "seedbox_list_filter";
const PLATFORM_KEY = "seedbox_platform_filter";
const SIDEBAR_COLLAPSED_KEY = "seedbox_sidebar_collapsed";
const LIST_SCROLL_KEY = "seedbox_list_scroll_y";
const MOBILE_BREAKPOINT = 980;
const CARD_EXCERPT_LIMIT_MOBILE = 110;
const CARD_EXCERPT_LIMIT_DESKTOP = 220;
const DETAIL_MODE_BROWSE = "browse";
const DETAIL_MODE_EDIT = "edit";
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const NAKED_URL_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?/gi;
const URL_LEADING_TRIM_PATTERN = /^[\s"'`(<{\[（【「『]+/u;
const URL_TRAILING_TRIM_PATTERN = /[\s"'`)>}\]，。！？；：、,.!?;:）】」』]+$/u;
const GENERIC_TRACKING_PARAMS = ["from", "source", "spm", "fbclid", "gclid"];
const XHS_HOST_PATTERN = /(xiaohongshu\.com|xhslink\.com|xhscdn\.com)$/i;
const HASH_SEGMENT_PATTERN = /#([^\s#\n\r]{1,48})#/g;
const INLINE_HASH_SEGMENT_PATTERN = /(^|[\s\u3000])#[^\s#]+/g;
const SOCIAL_META_SUFFIX_PATTERN =
  /(?:\s*[·•|｜、,，\-]?\s*(?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天)(?:\s+[A-Za-z0-9\u4e00-\u9fa5_-]{1,16})?)\s*$/u;
const SOCIAL_TOPIC_META_SUFFIX_PATTERN =
  /(?:#?[^\s#]{0,24})?(?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天)(?:\s+[A-Za-z0-9\u4e00-\u9fa5_-]{1,16})?\s*$/u;
const SOCIAL_TIME_INLINE_PATTERN =
  /(?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天)(?:\s*[A-Za-z0-9\u4e00-\u9fa5_-]{0,16})?/gu;
const NOISE_WORD_PATTERN = /^(加载中|编辑于.*|展开|收起|全文|更多)$/u;
const NOISE_INLINE_PATTERN = /(?:加载中|编辑于\s*\S*|展开(?:全部)?|收起|查看更多?|全文)/gu;
const SHARE_TEXT_TAIL_PATTERN =
  /(?:%20|[+ ]+)(?:复制后打开|打开(?:小红书|抖音|微博|知乎)|查看笔记|查看详情|去看看|快来看看).*/iu;

let AUTH_DISABLED = true;
const CLIENT_TOKEN = String(window.SEEDBOX_CLIENT_TOKEN || localStorage.getItem(CLIENT_TOKEN_KEY) || "").trim();
let COMMERCIAL_MODE_ENABLED = false;

const captureForm = document.getElementById("capture-form");
const sourceUrlInput = document.getElementById("source-url");
const titleHintInput = document.getElementById("title-hint");
const tagsInput = document.getElementById("tags");
const createStatus = document.getElementById("create-status");
const captureProgress = document.getElementById("capture-progress");
const captureProgressBar = document.getElementById("capture-progress-bar");
const captureProgressText = document.getElementById("capture-progress-text");
const pasteDetectBtn = document.getElementById("paste-detect-btn");
const quickCaptureBtn = document.getElementById("quick-capture-btn");
const captureModal = document.getElementById("capture-modal");
const captureModalCloseBtn = document.getElementById("capture-modal-close");
const captureCancelBtn = document.getElementById("capture-cancel-btn");
const accountModal = document.getElementById("account-modal");
const accountModalCloseBtn = document.getElementById("account-modal-close");
const accountAuthStatus = document.getElementById("account-auth-status");
const accountLoginForm = document.getElementById("account-login-form");
const accountEmailInput = document.getElementById("account-email");
const accountDisplayNameInput = document.getElementById("account-display-name");
const accountCodeInput = document.getElementById("account-code");
const accountRequestCodeBtn = document.getElementById("account-request-code-btn");
const accountLoginBtn = document.getElementById("account-login-btn");
const accountLogoutBtn = document.getElementById("account-logout-btn");
const accountUserLine = document.getElementById("account-user-line");
const billingPlanLine = document.getElementById("billing-plan-line");
const billingStatusLine = document.getElementById("billing-status-line");
const billingError = document.getElementById("billing-error");
const billingRefreshBtn = document.getElementById("billing-refresh-btn");
const billingSubscribeBtn = document.getElementById("billing-subscribe-btn");
const billingCancelBtn = document.getElementById("billing-cancel-btn");
const refreshBtn = document.getElementById("refresh-btn");
const installBtn = document.getElementById("install-btn");
const currentUserBadge = document.getElementById("current-user");
const accountSettingsBtn = document.getElementById("account-settings-btn");
const backToTopBtn = document.getElementById("back-to-top-btn");
const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
const topbar = document.querySelector(".topbar");
const searchBtn = document.getElementById("search-btn");
const searchInput = document.getElementById("search-input");
const itemsList = document.getElementById("items-list");
const listFilters = document.getElementById("list-filters");
const platformFilters = document.getElementById("platform-filters");
const purgeArchivedBtn = document.getElementById("purge-archived-btn");
const bulkBar = document.getElementById("bulk-bar");
const bulkCount = document.getElementById("bulk-count");
const bulkArchiveBtn = document.getElementById("bulk-archive-btn");
const bulkRestoreBtn = document.getElementById("bulk-restore-btn");
const bulkClearBtn = document.getElementById("bulk-clear-btn");
const statCaptured = document.getElementById("stat-captured");

const detailPanel = document.querySelector(".panel-right");
const detailEmpty = document.getElementById("detail-empty");
const detailCard = document.getElementById("detail-card");
const detailTitle = document.getElementById("detail-title");
const detailDomain = document.getElementById("detail-domain");
const detailAvatar = document.getElementById("detail-avatar");
const detailPlatformLogo = document.getElementById("detail-platform-logo");
const detailCreatedAt = document.getElementById("detail-created-at");
const detailStatus = document.getElementById("detail-status");
const detailUrl = document.getElementById("detail-url");
const detailCloseBtn = document.getElementById("detail-close-btn");
const detailContent = document.getElementById("detail-content");
const detailAssetsSection = document.getElementById("detail-assets-section");
const detailAssetsMeta = document.getElementById("detail-assets-meta");
const detailAssetsGrid = document.getElementById("detail-assets-grid");
const goEditBtn = document.getElementById("go-edit-btn");
const backBrowseBtn = document.getElementById("back-browse-btn");
const archiveBtn = document.getElementById("archive-btn");
const restoreBtn = document.getElementById("restore-btn");
const generateSummaryBtn = document.getElementById("generate-summary-btn");
const summaryStatus = document.getElementById("summary-status");
const summaryPoints = document.getElementById("summary-points");
const summaryText = document.getElementById("summary-text");
const detailEditTitle = document.getElementById("detail-edit-title");
const detailEditTags = document.getElementById("detail-edit-tags");
const saveDetailBtn = document.getElementById("save-detail-btn");
const reparseBtn = document.getElementById("reparse-btn");
const deleteDetailBtn = document.getElementById("delete-detail-btn");
const refreshDiagnosticsBtn = document.getElementById("refresh-diagnostics-btn");
const diagnosticsStatus = document.getElementById("diagnostics-status");
const diagnosticsProgress = document.getElementById("diagnostics-progress");
const diagnosticsProgressBar = document.getElementById("diagnostics-progress-bar");
const toolbarSaveBtn = document.getElementById("toolbar-save-btn");
const toolbarReparseBtn = document.getElementById("toolbar-reparse-btn");
const toolbarDeleteBtn = document.getElementById("toolbar-delete-btn");
const toolbarCancelBtn = document.getElementById("toolbar-cancel-btn");
const noteForm = document.getElementById("note-form");
const noteTitleInput = document.getElementById("note-title");
const noteBodyInput = document.getElementById("note-body");
const notesList = document.getElementById("notes-list");
const browseOnlyBlocks = Array.from(document.querySelectorAll(".browse-only"));
const editOnlyBlocks = Array.from(document.querySelectorAll(".edit-only"));

const imageViewer = document.getElementById("image-viewer");
const imageViewerImg = document.getElementById("image-viewer-img");
const imageViewerVideo = document.getElementById("image-viewer-video");
const imageViewerMeta = document.getElementById("image-viewer-meta");
const imageViewerClose = document.getElementById("image-viewer-close");
const imageViewerPrev = document.getElementById("image-viewer-prev");
const imageViewerNext = document.getElementById("image-viewer-next");

let currentItemId = null;
let currentItem = null;
let currentDetailText = "";
let currentDetailAssets = [];
let currentDetailArchived = false;
let currentDetailMode = DETAIL_MODE_BROWSE;
let currentNotes = [];
let currentSummaryStatus = "idle";
let currentParserDiagnostics = null;
let currentRawItems = [];
let hasPendingItems = false;
let isAutoRefreshing = false;
let currentFilter = localStorage.getItem(FILTER_KEY) || "all";
let currentPlatform = localStorage.getItem(PLATFORM_KEY) || "all";
let sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
let selectedItemIds = new Set();
const expandedItemIds = new Set();

let deferredInstallPrompt = null;
let viewerAssets = [];
let viewerIndex = -1;
let touchStartX = null;
let lastItemsFingerprint = "";
let lastViewportWidth = window.innerWidth;
let resizeRaf = 0;
let accountBusy = false;
let billingBusy = false;
let billingPlans = [];
let billingState = null;
let authSession = readAuthSession();
let scrollSaveTimer = 0;

if (!["active", "archived", "all"].includes(currentFilter)) {
  currentFilter = "all";
}
if (accountEmailInput instanceof HTMLInputElement) {
  const rememberedEmail = String(localStorage.getItem(AUTH_EMAIL_KEY) || "").trim();
  if (rememberedEmail) {
    accountEmailInput.value = rememberedEmail;
  }
}

function baseHeaders() {
  return {
    ...(CLIENT_TOKEN ? { "x-client-token": CLIENT_TOKEN } : {})
  };
}

function readAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const accessToken = String(parsed?.accessToken || "").trim();
    const refreshToken = String(parsed?.refreshToken || "").trim();
    if (!accessToken || !refreshToken) {
      return null;
    }
    const user = parsed?.user && typeof parsed.user === "object" ? parsed.user : {};
    return {
      accessToken,
      refreshToken,
      accessExpiresIn: Number(parsed?.accessExpiresIn || 0),
      refreshExpiresIn: Number(parsed?.refreshExpiresIn || 0),
      user: {
        id: String(user.id || ""),
        email: String(user.email || ""),
        displayName: String(user.displayName || "")
      }
    };
  } catch {
    return null;
  }
}

function persistAuthSession(session) {
  authSession = session && typeof session === "object" ? session : null;
  if (authSession) {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(authSession));
    const email = String(authSession?.user?.email || "").trim();
    if (email) {
      localStorage.setItem(AUTH_EMAIL_KEY, email);
      if (accountEmailInput instanceof HTMLInputElement) {
        accountEmailInput.value = email;
      }
    }
  } else {
    localStorage.removeItem(AUTH_SESSION_KEY);
  }
  renderAccountUi();
}

function clearAuthSession() {
  persistAuthSession(null);
}

function resolveUserLabel() {
  const displayName = String(authSession?.user?.displayName || "").trim();
  const email = String(authSession?.user?.email || "").trim();
  if (displayName && email) {
    return `${displayName} (${email})`;
  }
  if (displayName) {
    return displayName;
  }
  if (email) {
    return email;
  }
  return "未登录";
}

function updateCurrentUserBadge() {
  if (!(currentUserBadge instanceof HTMLElement)) {
    return;
  }
  if (!COMMERCIAL_MODE_ENABLED) {
    currentUserBadge.textContent = "本地模式（免登录）";
    return;
  }
  if (authSession?.accessToken) {
    currentUserBadge.textContent = `商业模式 · ${resolveUserLabel()}`;
    return;
  }
  currentUserBadge.textContent = "商业模式（可启用账号订阅）";
}

async function requestJson(path, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    guest = false
  } = options;
  const mergedHeaders = {
    ...baseHeaders(),
    ...(guest ? { "x-user-id": DEMO_USER_ID } : {}),
    ...headers
  };
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: mergedHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function api(path, options = {}) {
  const headers = {
    ...(AUTH_DISABLED ? { "x-user-id": DEMO_USER_ID } : {}),
    ...baseHeaders(),
    ...(options.headers || {})
  };
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function responseError(response) {
  let message = `Request failed: ${response.status}`;
  try {
    const body = await response.json();
    if (typeof body?.message === "string" && body.message.trim().length > 0) {
      message = `${message} ${body.message}`;
    }
  } catch {
    // ignore
  }
  return message;
}

async function tryRefreshAuthSession() {
  const refreshToken = String(authSession?.refreshToken || "").trim();
  if (!refreshToken) {
    return false;
  }
  try {
    const refreshed = await requestJson("/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { refreshToken }
    });
    const next = {
      ...(authSession || {}),
      ...refreshed,
      user: {
        ...(authSession?.user || {}),
      }
    };
    persistAuthSession(next);
    return true;
  } catch {
    clearAuthSession();
    return false;
  }
}

async function authApi(path, options = {}, allowRefresh = true) {
  const accessToken = String(authSession?.accessToken || "").trim();
  if (!accessToken) {
    throw new Error("请先登录账号");
  }
  const headers = {
    ...baseHeaders(),
    authorization: `Bearer ${accessToken}`,
    ...(options.headers || {})
  };
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
  if (response.status === 401 && allowRefresh) {
    const refreshed = await tryRefreshAuthSession();
    if (refreshed) {
      return authApi(path, options, false);
    }
  }
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function syncAuthProfile({ silent = true } = {}) {
  if (!authSession?.accessToken) {
    return null;
  }
  try {
    const result = await authApi("/v1/auth/whoami", { method: "GET" });
    const nextUser = result?.user && typeof result.user === "object" ? result.user : {};
    persistAuthSession({
      ...authSession,
      user: {
        id: String(nextUser.id || authSession?.user?.id || ""),
        email: String(nextUser.email || authSession?.user?.email || ""),
        displayName: String(nextUser.displayName || authSession?.user?.displayName || "")
      }
    });
    return result?.user || null;
  } catch (error) {
    if (!silent) {
      setAccountStatus(errorMessage(error), true);
    }
    return null;
  }
}

async function loadClientFeatures() {
  try {
    const payload = await requestJson("/v1/health", {
      method: "GET"
    });
    const features = payload?.features || {};
    COMMERCIAL_MODE_ENABLED = features.commercialModeEnabled === true;
    if (!COMMERCIAL_MODE_ENABLED) {
      clearAuthSession();
      billingPlans = [];
      billingState = null;
    } else if (authSession?.accessToken) {
      await syncAuthProfile();
    }
  } catch {
    COMMERCIAL_MODE_ENABLED = false;
  }
  if (accountSettingsBtn instanceof HTMLElement) {
    accountSettingsBtn.classList.toggle("hidden", !COMMERCIAL_MODE_ENABLED);
  }
  updateCurrentUserBadge();
  renderAccountUi();
}

function setAccountStatus(message, isError = false) {
  if (!(accountAuthStatus instanceof HTMLElement)) {
    return;
  }
  accountAuthStatus.textContent = String(message || "");
  accountAuthStatus.style.color = isError ? "#b86a1f" : "#5a665d";
}

function setAccountBusy(next) {
  accountBusy = Boolean(next);
  if (accountRequestCodeBtn instanceof HTMLButtonElement) {
    accountRequestCodeBtn.disabled = accountBusy || !COMMERCIAL_MODE_ENABLED;
  }
  if (accountLoginBtn instanceof HTMLButtonElement) {
    accountLoginBtn.disabled = accountBusy || !COMMERCIAL_MODE_ENABLED;
  }
  if (accountLogoutBtn instanceof HTMLButtonElement) {
    accountLogoutBtn.disabled = accountBusy;
  }
}

function setBillingBusy(next) {
  billingBusy = Boolean(next);
  const disabled = billingBusy || !COMMERCIAL_MODE_ENABLED || !authSession?.accessToken;
  if (billingRefreshBtn instanceof HTMLButtonElement) {
    billingRefreshBtn.disabled = disabled;
  }
  if (billingSubscribeBtn instanceof HTMLButtonElement) {
    billingSubscribeBtn.disabled = disabled;
  }
  if (billingCancelBtn instanceof HTMLButtonElement) {
    billingCancelBtn.disabled = disabled;
  }
}

function syncModalBodyLock() {
  const captureOpen = captureModal instanceof HTMLElement && !captureModal.classList.contains("hidden");
  const accountOpen = accountModal instanceof HTMLElement && !accountModal.classList.contains("hidden");
  document.body.classList.toggle("modal-open", captureOpen || accountOpen);
}

function formatBillingPlan(planId) {
  const id = String(planId || "free");
  const found = billingPlans.find((plan) => String(plan?.id || "") === id);
  if (found) {
    return `${found.title}（¥${Number(found.priceCnyMonthly || 0)}/月）`;
  }
  if (id === "pro_monthly") {
    return "Pro Monthly（¥18/月）";
  }
  return "Free";
}

function formatBillingStatus(subscription) {
  if (!subscription) {
    return "未开通";
  }
  const status = String(subscription.status || "active");
  if (status === "active") {
    return subscription.currentPeriodEnd
      ? `已开通 · 到期 ${safeDate(subscription.currentPeriodEnd)}`
      : "已开通";
  }
  if (status === "canceled") {
    return subscription.currentPeriodEnd
      ? `已取消 · 到期 ${safeDate(subscription.currentPeriodEnd)}`
      : "已取消";
  }
  return status;
}

function renderBillingPanel() {
  const loggedIn = Boolean(authSession?.accessToken);
  const subscription = billingState?.subscription || null;
  if (accountUserLine instanceof HTMLElement) {
    accountUserLine.textContent = loggedIn ? `当前账号：${resolveUserLabel()}` : "当前账号：未登录";
  }
  if (billingPlanLine instanceof HTMLElement) {
    billingPlanLine.textContent = `当前方案：${formatBillingPlan(subscription?.plan || "free")}`;
  }
  if (billingStatusLine instanceof HTMLElement) {
    billingStatusLine.textContent = `状态：${loggedIn ? formatBillingStatus(subscription) : "登录后可查看"}`;
  }
  if (billingError instanceof HTMLElement) {
    const message = String(billingState?.error || "").trim();
    billingError.textContent = message;
    billingError.classList.toggle("hidden", !message);
  }
  const subscriptionStatus = String(subscription?.status || "");
  const canCancel = loggedIn && subscription?.plan === "pro_monthly" && subscriptionStatus === "active";
  if (billingCancelBtn instanceof HTMLButtonElement) {
    billingCancelBtn.classList.toggle("hidden", !canCancel);
  }
  if (billingSubscribeBtn instanceof HTMLButtonElement) {
    billingSubscribeBtn.textContent = canCancel ? "已开通 Pro" : "升级到 Pro";
  }
}

function renderAccountUi() {
  const commercial = COMMERCIAL_MODE_ENABLED;
  const loggedIn = Boolean(authSession?.accessToken);
  if (accountSettingsBtn instanceof HTMLElement) {
    accountSettingsBtn.classList.toggle("hidden", !commercial);
    accountSettingsBtn.textContent = loggedIn ? "账号订阅" : "登录订阅";
  }
  if (accountLoginBtn instanceof HTMLButtonElement) {
    accountLoginBtn.classList.toggle("hidden", !commercial);
  }
  if (accountRequestCodeBtn instanceof HTMLButtonElement) {
    accountRequestCodeBtn.classList.toggle("hidden", !commercial);
  }
  if (accountLogoutBtn instanceof HTMLButtonElement) {
    accountLogoutBtn.classList.toggle("hidden", !commercial || !loggedIn);
  }
  if (accountCodeInput instanceof HTMLInputElement) {
    accountCodeInput.disabled = !commercial;
  }
  if (accountEmailInput instanceof HTMLInputElement) {
    accountEmailInput.disabled = !commercial || loggedIn;
  }
  if (accountDisplayNameInput instanceof HTMLInputElement) {
    accountDisplayNameInput.disabled = !commercial || loggedIn;
  }
  if (!commercial) {
    setAccountStatus("当前为本地模式，登录订阅功能已关闭。");
  } else if (loggedIn) {
    setAccountStatus("登录成功，可管理订阅状态。");
  } else {
    setAccountStatus("请输入邮箱并获取验证码登录。");
  }
  updateCurrentUserBadge();
  renderBillingPanel();
  setBillingBusy(billingBusy);
  setAccountBusy(accountBusy);
  updateLayoutOffsets();
}

async function refreshBillingState({ silent = false } = {}) {
  if (!COMMERCIAL_MODE_ENABLED || !authSession?.accessToken) {
    billingState = null;
    billingPlans = [];
    renderAccountUi();
    return;
  }
  try {
    setBillingBusy(true);
    const plansPayload = await requestJson("/v1/billing/plans", { method: "GET" });
    billingPlans = Array.isArray(plansPayload?.plans) ? plansPayload.plans : [];
    const nextState = await authApi("/v1/billing/subscription", { method: "GET" });
    billingState = {
      ...nextState,
      error: ""
    };
    renderAccountUi();
  } catch (error) {
    billingState = {
      ...(billingState || {}),
      error: errorMessage(error)
    };
    renderAccountUi();
    if (!silent) {
      setAccountStatus(`订阅状态获取失败：${errorMessage(error)}`, true);
    }
  } finally {
    setBillingBusy(false);
  }
}

async function requestAuthCode() {
  if (!COMMERCIAL_MODE_ENABLED) {
    setAccountStatus("当前模式未启用登录订阅。", true);
    return;
  }
  const email = String(accountEmailInput?.value || "").trim().toLowerCase();
  const displayName = String(accountDisplayNameInput?.value || "").trim();
  if (!email || !/.+@.+\..+/u.test(email)) {
    setAccountStatus("请输入有效邮箱地址", true);
    return;
  }
  localStorage.setItem(AUTH_EMAIL_KEY, email);
  try {
    setAccountBusy(true);
    const result = await requestJson("/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        email,
        ...(displayName ? { displayName } : {})
      }
    });
    const ttlMinutes = Math.max(1, Math.round(Number(result?.expiresInMs || 0) / 60000));
    const devCode = String(result?.devCode || "").trim();
    if (devCode && accountCodeInput instanceof HTMLInputElement) {
      accountCodeInput.value = devCode;
      setAccountStatus(`验证码已发送（开发码：${devCode}），有效期约 ${ttlMinutes} 分钟`);
    } else {
      setAccountStatus(`验证码已发送，请检查邮箱（有效期约 ${ttlMinutes} 分钟）`);
    }
  } catch (error) {
    setAccountStatus(`发送失败：${errorMessage(error)}`, true);
  } finally {
    setAccountBusy(false);
  }
}

async function verifyAuthCodeAndLogin() {
  if (!COMMERCIAL_MODE_ENABLED) {
    setAccountStatus("当前模式未启用登录订阅。", true);
    return;
  }
  const email = String(accountEmailInput?.value || "").trim().toLowerCase();
  const code = String(accountCodeInput?.value || "").trim();
  const displayName = String(accountDisplayNameInput?.value || "").trim();
  if (!email || !/.+@.+\..+/u.test(email)) {
    setAccountStatus("请输入有效邮箱地址", true);
    return;
  }
  if (!/^\d{6}$/u.test(code)) {
    setAccountStatus("请输入 6 位数字验证码", true);
    return;
  }
  try {
    setAccountBusy(true);
    const session = await requestJson("/v1/auth/verify-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        email,
        code,
        ...(displayName ? { displayName } : {})
      }
    });
    persistAuthSession(session);
    if (accountCodeInput instanceof HTMLInputElement) {
      accountCodeInput.value = "";
    }
    setAccountStatus("登录成功");
    await refreshBillingState({ silent: true });
  } catch (error) {
    setAccountStatus(`登录失败：${errorMessage(error)}`, true);
  } finally {
    setAccountBusy(false);
  }
}

function logoutAuthSession() {
  clearAuthSession();
  billingState = null;
  billingPlans = [];
  renderAccountUi();
  setAccountStatus("已退出登录");
}

async function subscribeProPlan() {
  if (!authSession?.accessToken) {
    setAccountStatus("请先登录后再订阅", true);
    return;
  }
  try {
    setBillingBusy(true);
    const next = await authApi("/v1/billing/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "pro_monthly", provider: "mock" })
    });
    billingState = {
      ...next,
      error: ""
    };
    renderAccountUi();
    setAccountStatus("已开通 Pro 订阅");
  } catch (error) {
    setAccountStatus(`开通失败：${errorMessage(error)}`, true);
  } finally {
    setBillingBusy(false);
  }
}

async function cancelSubscription() {
  if (!authSession?.accessToken) {
    setAccountStatus("请先登录后再操作", true);
    return;
  }
  const ok = window.confirm("确认取消订阅吗？已开通周期内仍可使用。");
  if (!ok) {
    return;
  }
  try {
    setBillingBusy(true);
    const next = await authApi("/v1/billing/cancel", {
      method: "POST"
    });
    billingState = {
      ...next,
      error: ""
    };
    renderAccountUi();
    setAccountStatus("已提交取消订阅");
  } catch (error) {
    setAccountStatus(`取消失败：${errorMessage(error)}`, true);
  } finally {
    setBillingBusy(false);
  }
}

async function openAccountModal() {
  if (!COMMERCIAL_MODE_ENABLED) {
    setCreateStatus("当前服务未开启商业模式", true);
    return;
  }
  if (!(accountModal instanceof HTMLElement)) {
    return;
  }
  accountModal.classList.remove("hidden");
  syncModalBodyLock();
  renderAccountUi();
  if (authSession?.accessToken) {
    await refreshBillingState({ silent: true });
  }
}

function closeAccountModal() {
  if (!(accountModal instanceof HTMLElement)) {
    return;
  }
  accountModal.classList.add("hidden");
  syncModalBodyLock();
}

function setCreateStatus(message, isError = false) {
  createStatus.textContent = String(message || "");
  createStatus.style.color = isError ? "#b86a1f" : "#5a665d";
}

function setCaptureProgress(progress, label) {
  if (!(captureProgress instanceof HTMLElement) || !(captureProgressBar instanceof HTMLElement)) {
    return;
  }
  const normalized = Math.max(0, Math.min(100, Number(progress) || 0));
  captureProgress.classList.toggle("hidden", normalized <= 0 || normalized >= 100);
  captureProgressBar.style.width = `${normalized}%`;
  captureProgress.setAttribute("aria-valuenow", String(Math.round(normalized)));
  if (captureProgressText instanceof HTMLElement) {
    const safeLabel = String(label || "").trim();
    captureProgressText.textContent = safeLabel ? `${safeLabel} · ${Math.round(normalized)}%` : `${Math.round(normalized)}%`;
    captureProgressText.classList.toggle("hidden", normalized <= 0 || normalized >= 100);
  }
}

function clearCaptureProgress() {
  if (captureProgress instanceof HTMLElement) {
    captureProgress.classList.add("hidden");
    captureProgress.setAttribute("aria-valuenow", "0");
  }
  if (captureProgressBar instanceof HTMLElement) {
    captureProgressBar.style.width = "0%";
  }
  if (captureProgressText instanceof HTMLElement) {
    captureProgressText.textContent = "";
    captureProgressText.classList.add("hidden");
  }
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set(values)];
}

function sanitizeTagText(value) {
  const cleaned = String(value || "")
    .replace(/[\[\]【】()（）]/g, "")
    .replace(SOCIAL_TIME_INLINE_PATTERN, " ")
    .replace(NOISE_INLINE_PATTERN, " ")
    .replace(/(?:\d+\s*(?:分钟|小时|天|周|月|年)前)(?:\s*[A-Za-z\u4e00-\u9fa5·・_-]{0,16})$/u, "")
    .replace(/(?:话题|超话)$/u, "")
    .replace(/^[#＃]+/u, "")
    .replace(/[，。！？!?,.;:：、]+$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 24) {
    return "";
  }
  if (/^https?:/i.test(cleaned)) {
    return "";
  }
  if (/(?:分钟|小时|天|周|月|年)前/u.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function displayTagsOf(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const cleaned = sanitizeTagText(tag);
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function sanitizeExcerptText(input, { preserveNewlines = false } = {}) {
  const text = String(input || "").replace(/\r/g, "").trim();
  if (!text) {
    return "";
  }
  const lines = preserveNewlines ? text.split("\n") : [text.replaceAll(/\s+/g, " ")];
  const cleaned = lines
    .map((line) => {
      let next = String(line || "").replace(/\s{2,}/g, " ").trim();
      while (SOCIAL_TOPIC_META_SUFFIX_PATTERN.test(next)) {
        next = next.replace(SOCIAL_TOPIC_META_SUFFIX_PATTERN, " ").trim();
      }
      return next
        .replace(SOCIAL_TIME_INLINE_PATTERN, " ")
        .replace(HASH_SEGMENT_PATTERN, " ")
        .replace(/#[^\s#]+/g, " ")
        .replace(/\[(话题|超话)\]/g, "")
        .replace(NOISE_INLINE_PATTERN, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    })
    .map((line) => {
      let next = line;
      while (SOCIAL_META_SUFFIX_PATTERN.test(next)) {
        next = next.replace(SOCIAL_META_SUFFIX_PATTERN, " ").trim();
      }
      if (NOISE_WORD_PATTERN.test(next)) {
        return "";
      }
      return next.replace(/\s{2,}/g, " ").trim();
    })
    .filter(Boolean);
  if (preserveNewlines) {
    return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return cleaned.join(" ").replace(/\s{2,}/g, " ").trim();
}

function itemLabel(item) {
  return item.title && item.title.trim().length > 0 ? item.title : item.sourceUrl;
}

function displayTopic(item) {
  const platform = normalizeItemPlatform(item);
  if (platform.id === "weibo") {
    const author = displayAuthor(item);
    if (author) {
      return `${author} 的微博`;
    }
  }
  const title = String(item.title || "").trim();
  const cleanedTitle = title
    .replace(/\s*[-|｜]\s*(小红书|微博|知乎|Instagram|豆瓣|抖音|Bilibili|微信|YouTube|X|Twitter)\s*$/i, "")
    .replace(/\s*-\s*你的生活兴趣社区\s*$/i, "")
    .trim();
  const stripped = stripAuthorTailFromTitle(cleanedTitle);
  if (stripped) {
    return stripped;
  }
  const excerptTopic = inferTopicFromExcerpt(item.excerpt);
  if (excerptTopic) {
    return excerptTopic;
  }
  return `${normalizeItemPlatform(item).label} 收藏`;
}

function extractAuthorFromTitle(title) {
  const value = String(title || "").trim();
  if (!value) {
    return "";
  }
  const parts = value.split(/\s[-|｜]\s/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return "";
  }
  const candidate = parts[parts.length - 1];
  if (candidate.length < 2 || candidate.length > 24) {
    return "";
  }
  if (/(小红书|微博|知乎|Instagram|豆瓣|抖音|Bilibili|微信|YouTube|X|Twitter|社区)$/i.test(candidate)) {
    return "";
  }
  if (/^https?:/i.test(candidate)) {
    return "";
  }
  return candidate.replace(/\s*(关注|已关注).*$/u, "").trim();
}

function stripAuthorTailFromTitle(title) {
  const value = String(title || "").trim();
  if (!value) {
    return "";
  }
  const author = extractAuthorFromTitle(value);
  if (!author) {
    return value;
  }
  return value.replace(new RegExp(`\\s[-|｜]\\s*${author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim() || value;
}

function inferTopicFromExcerpt(input) {
  const text = sanitizeExcerptText(input);
  if (!text) {
    return "";
  }
  const first = text
    .split(/[\n。！？!?]/)
    .map((line) => line.trim())
    .find((line) => line.length >= 4);
  if (!first) {
    return "";
  }
  const topic = first
    .replace(/#[^#\s]+/g, "")
    .replace(/\[(话题|超话)\]/g, "")
    .trim();
  if (!topic) {
    return "";
  }
  return topic.length > 64 ? `${topic.slice(0, 64).trimEnd()}…` : topic;
}

function buildTopicLink(topic, sourceUrl, className) {
  const link = document.createElement("a");
  link.className = className;
  link.href = String(sourceUrl || "#");
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.textContent = topic;
  link.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  return link;
}

function isDoubanMovieItem(item) {
  const source = String(item?.sourceUrl || "").toLowerCase();
  if (source.includes("movie.douban.com/subject/")) {
    return true;
  }
  const excerpt = String(item?.excerpt || "");
  return excerpt.includes("片名：") && excerpt.includes("豆瓣评分：");
}

function compactDoubanTopic(input) {
  const cleaned = String(input || "")
    .replace(/\s*[-|｜]\s*豆瓣.*$/i, "")
    .replace(/[【】[\]()（）]/g, " ")
    .replace(/[，。！？!?,;:：、]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length > 14 ? `${cleaned.slice(0, 14).trimEnd()}…` : cleaned;
}

function displayDoubanAuthor(item) {
  if (isDoubanMovieItem(item)) {
    return "豆瓣电影";
  }

  const source = String(item?.sourceUrl || "");
  try {
    const parsed = new URL(source);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host.includes("book.douban.com")) {
      return "豆瓣图书";
    }
    if (host.includes("music.douban.com")) {
      return "豆瓣音乐";
    }
    if (host.includes("group.douban.com") || path.includes("/group/topic/")) {
      return "豆瓣小组";
    }
    if (host.includes("read.douban.com")) {
      return "豆瓣阅读";
    }
    if (path.includes("/review/")) {
      return "豆瓣影评";
    }
    if (path.includes("/note/")) {
      return "豆瓣日记";
    }
    if (path.includes("/photo/") || path.includes("/photos/")) {
      return "豆瓣相册";
    }
    if (path.includes("/event/")) {
      return "豆瓣活动";
    }
    if (path.includes("/people/")) {
      return "豆瓣用户";
    }
    if (path.includes("/subject/")) {
      return "豆瓣条目";
    }
  } catch {
    // ignore
  }

  const topic = compactDoubanTopic(stripAuthorTailFromTitle(item?.title) || inferTopicFromExcerpt(item?.excerpt));
  if (topic) {
    return `豆瓣${topic}`;
  }
  return "豆瓣内容";
}

function displayAuthor(item) {
  const platform = normalizeItemPlatform(item);
  if (platform.id === "douban") {
    return displayDoubanAuthor(item);
  }
  const title = String(item.title || "").trim();
  const weiboTitleAuthor = title.match(/^(.+?)\s*的微博$/u)?.[1]?.trim();
  if (weiboTitleAuthor) {
    return weiboTitleAuthor;
  }
  const titleAuthor = extractAuthorFromTitle(title);
  if (titleAuthor) {
    return titleAuthor;
  }

  const source = String(item.sourceUrl || "");
  try {
    const parsed = new URL(source);
    const segments = parsed.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (
      (parsed.hostname.includes("weibo.com") || parsed.hostname.includes("x.com") || parsed.hostname.includes("twitter.com")) &&
      segments[0] &&
      !["status", "subject", "p", "o"].includes(segments[0].toLowerCase())
    ) {
      return segments[0];
    }
    if (parsed.hostname.includes("instagram.com") && segments[0] && segments[0].toLowerCase() !== "p") {
      return segments[0];
    }
    if (parsed.hostname.includes("zhihu.com") && segments[0] === "people" && segments[1]) {
      return segments[1];
    }
    if (parsed.hostname.includes("douyin.com") && segments[0] === "user" && segments[1]) {
      return segments[1];
    }
  } catch {
    // ignore
  }
  return `${platform.label}博主`;
}

function avatarSeed(text) {
  const chars = String(text || "").replace(/\s+/g, "");
  return chars ? chars.slice(0, 1).toUpperCase() : "S";
}

function platformSymbol(platformId, platformLabel) {
  const id = String(platformId || "").toLowerCase();
  if (id === "xiaohongshu") {
    return "红";
  }
  if (id === "douyin") {
    return "抖";
  }
  if (id === "weibo") {
    return "微";
  }
  if (id === "zhihu") {
    return "知";
  }
  if (id === "douban") {
    return "豆";
  }
  if (id === "instagram") {
    return "IG";
  }
  if (id === "x") {
    return "X";
  }
  if (id === "youtube") {
    return "YT";
  }
  if (id === "bilibili") {
    return "B";
  }
  if (id === "wechat") {
    return "微";
  }
  return String(platformLabel || "网").slice(0, 2);
}

function resolveSiteIconUrl(item) {
  const raw = String(item.siteIconUrl || "").trim();
  if (!raw) {
    return null;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return `${API_BASE}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function resolveItemAvatarUrl(item) {
  const candidate = String(item.authorAvatarUrl || "").trim();
  if (candidate) {
    if (/^https?:\/\//i.test(candidate)) {
      return candidate;
    }
    return `${API_BASE}${candidate.startsWith("/") ? candidate : `/${candidate}`}`;
  }
  const previews = previewImagesOf(item);
  const avatarLike = previews.find((asset) => /avatar|profile|head|user|sns-avatar/i.test(String(asset.url || "")));
  if (avatarLike) {
    return avatarLike.url;
  }
  return null;
}

function renderAvatar(avatarElement, avatarUrl, fallbackText) {
  if (!(avatarElement instanceof HTMLElement)) {
    return;
  }
  avatarElement.textContent = "";
  avatarElement.classList.remove("with-image");
  if (avatarUrl) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.alt = fallbackText;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      avatarElement.classList.remove("with-image");
      avatarElement.textContent = avatarSeed(fallbackText);
    });
    avatarElement.appendChild(img);
    avatarElement.classList.add("with-image");
    return;
  }
  avatarElement.textContent = avatarSeed(fallbackText);
}

function renderPlatformLogo(logoElement, item, platform) {
  if (!(logoElement instanceof HTMLElement)) {
    return;
  }
  const fallback = platformSymbol(platform.id, platform.label);
  logoElement.textContent = fallback;
  logoElement.classList.remove("with-image");

  const iconUrl = resolveSiteIconUrl(item);
  if (!iconUrl) {
    return;
  }
  const img = document.createElement("img");
  img.src = iconUrl;
  img.alt = platform.label;
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => {
    logoElement.classList.remove("with-image");
    logoElement.textContent = fallback;
  });
  logoElement.textContent = "";
  logoElement.classList.add("with-image");
  logoElement.appendChild(img);
}

function statusClass(status) {
  return status === "failed" ? "badge failed" : "badge";
}

function safeDate(input) {
  const date = new Date(input || "");
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function normalizeHttpUrl(raw) {
  const candidate = String(raw || "")
    .trim()
    .replace(URL_LEADING_TRIM_PATTERN, "")
    .replace(URL_TRAILING_TRIM_PATTERN, "");
  if (!candidate) {
    return null;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) && /https?:\/\//i.test(candidate)) {
    return null;
  }

  const candidates = [candidate];
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidates.push(`https://${candidate}`);
  }

  for (const value of candidates) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      if (!isLikelyRealHost(parsed.hostname)) {
        continue;
      }
      return canonicalizeHttpUrl(parsed).toString();
    } catch {
      // try next
    }
  }
  return null;
}

function extractFirstHttpUrl(raw) {
  const input = String(raw || "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!input) {
    return null;
  }

  const matches = input.match(URL_PATTERN);
  if (matches) {
    for (const match of matches) {
      const normalized = normalizeHttpUrl(match);
      if (normalized) {
        return normalized;
      }
    }
  }

  if (isLikelyStandaloneInput(input)) {
    const direct = normalizeHttpUrl(input);
    if (direct) {
      return direct;
    }
  }

  const nakedMatches = input.match(NAKED_URL_PATTERN);
  if (!nakedMatches) {
    return null;
  }
  for (const match of nakedMatches) {
    if (/https?:/i.test(match) || /[\u4e00-\u9fff]/u.test(match)) {
      continue;
    }
    const normalized = normalizeHttpUrl(match);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function isLikelyStandaloneInput(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return false;
  }
  if (/\s/.test(trimmed)) {
    return false;
  }
  if (/[\u4e00-\u9fff]/u.test(trimmed)) {
    return false;
  }
  return true;
}

function isLikelyRealHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) {
    return false;
  }
  if (host === "localhost") {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true;
  }
  return host.includes(".");
}

function canonicalizeHttpUrl(url) {
  const canonical = new URL(url.toString());
  const host = canonical.hostname.toLowerCase();
  if (XHS_HOST_PATTERN.test(host)) {
    sanitizeXhsPathInUrl(canonical);
    canonical.hash = "";
    return canonical;
  }

  const toDelete = new Set();
  canonical.searchParams.forEach((_, key) => {
    const lowerKey = String(key).toLowerCase();
    if (lowerKey.startsWith("utm_")) {
      toDelete.add(key);
      return;
    }
    if (GENERIC_TRACKING_PARAMS.includes(lowerKey)) {
      toDelete.add(key);
    }
  });
  toDelete.forEach((key) => canonical.searchParams.delete(key));
  canonical.hash = "";
  return canonical;
}

function sanitizeXhsPathInUrl(url) {
  const currentPath = String(url.pathname || "");
  if (!currentPath) {
    return;
  }
  let path = currentPath;
  const encodedSpaceIndex = path.toLowerCase().indexOf("%20");
  if (encodedSpaceIndex > 0) {
    path = path.slice(0, encodedSpaceIndex);
  }
  const stripped = path.replace(SHARE_TEXT_TAIL_PATTERN, "");
  const normalized = stripped.replace(/%20+$/i, "").replace(/\+$/g, "").replace(/\s+$/u, "");
  url.pathname = normalized || "/";
}

function tryExtractCaptureUrl(rawText, { setFieldValue = false } = {}) {
  const extracted = extractFirstHttpUrl(rawText);
  if (!extracted) {
    return null;
  }
  if (setFieldValue) {
    sourceUrlInput.value = extracted;
  }
  return extracted;
}

async function detectClipboardUrl({ silent = false } = {}) {
  if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
    if (!silent) {
      setCreateStatus("当前浏览器不支持读取剪贴板", true);
    }
    return null;
  }

  try {
    const text = await navigator.clipboard.readText();
    const extracted = tryExtractCaptureUrl(text, { setFieldValue: true });
    if (!extracted) {
      if (!silent) {
        setCreateStatus("剪贴板里未识别到可用链接", true);
      }
      return null;
    }
    if (!silent) {
      setCreateStatus("已从剪贴板识别链接");
    }
    return extracted;
  } catch {
    if (!silent) {
      setCreateStatus("读取剪贴板失败，请手动粘贴", true);
    }
    return null;
  }
}

function openCaptureModal() {
  if (!captureModal) {
    return;
  }
  captureModal.classList.remove("hidden");
  syncModalBodyLock();
}

function closeCaptureModal() {
  if (!captureModal) {
    return;
  }
  captureModal.classList.add("hidden");
  syncModalBodyLock();
}

function promptManualShareText(message = "请粘贴分享链接或整段分享文案") {
  const input = window.prompt(message, "");
  if (input === null) {
    return null;
  }
  return String(input).trim();
}

async function quickCaptureFlow() {
  const extracted = await detectClipboardUrl({ silent: true });
  if (extracted) {
    sourceUrlInput.value = extracted;
    titleHintInput.value = "";
    tagsInput.value = "";
    setCreateStatus("已识别剪贴板链接，正在保存...");
    await submitCapture();
    return;
  }

  const manualText = promptManualShareText("无法直接读取剪贴板，请手动粘贴分享文案或链接");
  if (manualText) {
    const manualUrl = tryExtractCaptureUrl(manualText, { setFieldValue: true });
    if (manualUrl) {
      setCreateStatus("已识别手动粘贴内容，正在保存...");
      await submitCapture();
      return;
    }
    sourceUrlInput.value = manualText;
  }

  openCaptureModal();
  setCreateStatus("未识别到链接，请在弹窗内粘贴需要识别的地址", true);
  sourceUrlInput.focus();
}

function detectPlatformClient(item) {
  const source = String(item.sourceUrl || item.canonicalUrl || "").toLowerCase();
  if (source.includes("xhslink.com") || source.includes("xiaohongshu.com")) {
    return { id: "xiaohongshu", label: "小红书" };
  }
  if (source.includes("douyin.com") || source.includes("iesdouyin.com")) {
    return { id: "douyin", label: "抖音" };
  }
  if (source.includes("instagram.com")) {
    return { id: "instagram", label: "Instagram" };
  }
  if (source.includes("weibo.com") || source.includes("weibo.cn")) {
    return { id: "weibo", label: "微博" };
  }
  if (source.includes("zhihu.com")) {
    return { id: "zhihu", label: "知乎" };
  }
  if (source.includes("douban.com")) {
    return { id: "douban", label: "豆瓣" };
  }
  if (source.includes("x.com") || source.includes("twitter.com")) {
    return { id: "x", label: "X" };
  }
  if (source.includes("bilibili.com")) {
    return { id: "bilibili", label: "Bilibili" };
  }
  if (source.includes("youtube.com") || source.includes("youtu.be")) {
    return { id: "youtube", label: "YouTube" };
  }
  if (source.includes("mp.weixin.qq.com") || source.includes("weixin.qq.com")) {
    return { id: "wechat", label: "微信" };
  }
  return { id: "web", label: "网页" };
}

function normalizeItemPlatform(item) {
  if (item.platform && item.platformLabel) {
    return { id: String(item.platform), label: String(item.platformLabel) };
  }
  return detectPlatformClient(item);
}

function uniqueMediaSources(...groups) {
  const seen = new Set();
  const output = [];
  for (const group of groups) {
    const entries = Array.isArray(group) ? group : [group];
    for (const value of entries) {
      const url = String(value || "").trim();
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      output.push(url);
    }
  }
  return output;
}

function buildPreviewAsset(asset, mediaType) {
  if (!asset || typeof asset !== "object") {
    return null;
  }
  const sources = uniqueMediaSources(asset.previewUrl, asset.downloadUrl, asset.url);
  if (sources.length === 0) {
    return null;
  }
  return {
    mediaType,
    url: sources[0],
    sources,
    width: Number(asset.width),
    height: Number(asset.height),
    sortOrder: Number.isFinite(Number(asset.sortOrder)) ? Number(asset.sortOrder) : Number.MAX_SAFE_INTEGER
  };
}

function previewImagesOf(item) {
  const images = Array.isArray(item.previewImages) ? item.previewImages : [];
  return images.map((img) => buildPreviewAsset(img, "image")).filter(Boolean);
}

function previewVideosOf(item) {
  const videos = Array.isArray(item.previewVideos) ? item.previewVideos : [];
  return videos.map((video) => buildPreviewAsset(video, "video")).filter(Boolean);
}

function previewMediaOf(item) {
  const images = previewImagesOf(item);
  const videos = previewVideosOf(item);
  return [...images, ...videos].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    if (a.mediaType === b.mediaType) {
      return 0;
    }
    return a.mediaType === "image" ? -1 : 1;
  });
}

function previewMediaCountOf(item) {
  return previewMediaOf(item).length;
}

function mergeItemMediaSummary(previous, next) {
  if (!previous) {
    return next;
  }
  const merged = { ...previous, ...next };
  if (!merged.authorAvatarUrl && previous.authorAvatarUrl) {
    merged.authorAvatarUrl = previous.authorAvatarUrl;
  }
  if (!merged.coverImageUrl && previous.coverImageUrl) {
    merged.coverImageUrl = previous.coverImageUrl;
  }
  const prevMediaCount = previewMediaCountOf(previous);
  const nextMediaCount = previewMediaCountOf(next);
  if (
    prevMediaCount > 0 &&
    nextMediaCount === 0 &&
    String(previous.status || "") === "ready" &&
    String(next.status || "") === "ready"
  ) {
    if (Array.isArray(previous.previewImages) && previous.previewImages.length > 0) {
      merged.previewImages = previous.previewImages;
    }
    if (Array.isArray(previous.previewVideos) && previous.previewVideos.length > 0) {
      merged.previewVideos = previous.previewVideos;
    }
    merged.imageCount = Math.max(Number(next.imageCount || 0), Number(previous.imageCount || 0));
    merged.videoCount = Math.max(Number(next.videoCount || 0), Number(previous.videoCount || 0));
  }
  return merged;
}

function mergeItemSummaries(previousItems, nextItems) {
  const previousMap = new Map((previousItems || []).map((item) => [item.id, item]));
  return (nextItems || []).map((item) => mergeItemMediaSummary(previousMap.get(item.id), item));
}

function previewTokenOf(item, field) {
  const list = Array.isArray(item?.[field]) ? item[field] : [];
  return list
    .map((asset) =>
      [asset?.id || "", asset?.previewUrl || "", asset?.downloadUrl || "", asset?.url || "", asset?.sortOrder || ""].join(
        "|"
      )
    )
    .join("~");
}

function applyMediaElementSource(element, url) {
  if (!url) {
    return false;
  }
  if ("src" in element && element.src === url) {
    return true;
  }
  element.src = url;
  if (element instanceof HTMLVideoElement) {
    element.load();
  }
  return true;
}

function mountMediaWithFallback(element, sources, onExhausted) {
  const queue = uniqueMediaSources(sources);
  if (queue.length === 0) {
    if (typeof onExhausted === "function") {
      onExhausted();
    }
    return;
  }
  let index = 0;
  const handleError = () => {
    index += 1;
    if (index < queue.length) {
      applyMediaElementSource(element, queue[index]);
      return;
    }
    element.removeEventListener("error", handleError);
    if (typeof onExhausted === "function") {
      onExhausted();
    }
  };
  element.addEventListener("error", handleError);
  applyMediaElementSource(element, queue[index]);
}

function refreshFilterUi() {
  for (const button of listFilters.querySelectorAll(".filter-btn")) {
    button.classList.toggle("active", button.dataset.filter === currentFilter);
  }
  purgeArchivedBtn.classList.add("hidden");
}

function refreshBulkUi() {
  selectedItemIds.clear();
  bulkBar.classList.add("hidden");
}

function isMobileViewport() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function updateLayoutOffsets() {
  const root = document.documentElement;
  let topbarHeight = isMobileViewport() ? 68 : 82;
  if (topbar instanceof HTMLElement) {
    const rect = topbar.getBoundingClientRect();
    if (Number.isFinite(rect.height) && rect.height > 0) {
      topbarHeight = Math.round(rect.height);
    }
  }
  const normalized = Math.max(isMobileViewport() ? 56 : 72, Math.min(220, topbarHeight));
  root.style.setProperty("--topbar-height", `${normalized}px`);
}

function setSidebarCollapsed(next) {
  sidebarCollapsed = Boolean(next);
  if (!isMobileViewport()) {
    document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  } else {
    document.body.classList.remove("sidebar-collapsed");
  }
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
  if (sidebarToggleBtn) {
    sidebarToggleBtn.textContent = sidebarCollapsed ? "展开" : "收起";
    sidebarToggleBtn.setAttribute("aria-expanded", sidebarCollapsed ? "false" : "true");
  }
}

function rememberListScroll() {
  if (scrollSaveTimer) {
    window.clearTimeout(scrollSaveTimer);
  }
  scrollSaveTimer = window.setTimeout(() => {
    scrollSaveTimer = 0;
    sessionStorage.setItem(LIST_SCROLL_KEY, String(window.scrollY || 0));
  }, 120);
}

function restoreListScroll() {
  const saved = Number(sessionStorage.getItem(LIST_SCROLL_KEY) || "0");
  if (!Number.isFinite(saved) || saved <= 0) {
    return;
  }
  window.requestAnimationFrame(() => {
    window.scrollTo({
      top: saved,
      behavior: "auto"
    });
  });
}

function toggleBackToTop() {
  if (!(backToTopBtn instanceof HTMLElement)) {
    return;
  }
  const shouldShow = window.scrollY > 520;
  backToTopBtn.classList.toggle("hidden", !shouldShow);
}

function cardExcerptLimit() {
  return isMobileViewport() ? CARD_EXCERPT_LIMIT_MOBILE : CARD_EXCERPT_LIMIT_DESKTOP;
}

function cardTextSource(item) {
  const plainText = sanitizeExcerptText(item?.plainText, { preserveNewlines: true });
  if (plainText) {
    return plainText;
  }
  return sanitizeExcerptText(item?.excerpt, { preserveNewlines: true });
}

function buildCardExcerpt(item) {
  const source = cardTextSource(item);
  if (!source) {
    return { text: "", truncated: false };
  }
  const limit = cardExcerptLimit();
  if (source.length <= limit) {
    return { text: source, truncated: false };
  }
  return { text: `${source.slice(0, limit).trimEnd()}…`, truncated: true };
}

function renderRichTextBlocks(container, text) {
  if (!(container instanceof HTMLElement)) {
    return;
  }
  const value = String(text || "").trim();
  if (!value) {
    container.innerHTML = "";
    return;
  }
  const blocks = value
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line).replaceAll("\n", "<br/>")}</p>`);
  container.innerHTML = blocks.join("");
}

function refreshSidebarStats(items) {
  const list = Array.isArray(items) ? items : [];
  const captured = list.length;
  if (statCaptured) {
    statCaptured.textContent = String(captured);
  }
}

function activeDetailRoute() {
  const route = new URL(window.location.href);
  const itemId = route.searchParams.get("item");
  return typeof itemId === "string" && itemId.trim().length > 0 ? itemId.trim() : null;
}

function activeDetailMode() {
  const route = new URL(window.location.href);
  return route.searchParams.get("mode") === DETAIL_MODE_EDIT ? DETAIL_MODE_EDIT : DETAIL_MODE_BROWSE;
}

function updateDetailRoute(itemId, { replace = false, mode = DETAIL_MODE_BROWSE } = {}) {
  const route = new URL(window.location.href);
  const before = `${route.pathname}${route.search}${route.hash}`;
  if (itemId) {
    route.searchParams.set("item", itemId);
    if (mode === DETAIL_MODE_EDIT) {
      route.searchParams.set("mode", DETAIL_MODE_EDIT);
    } else {
      route.searchParams.delete("mode");
    }
  } else {
    route.searchParams.delete("item");
    route.searchParams.delete("mode");
  }
  const after = `${route.pathname}${route.search}${route.hash}`;
  if (after === before) {
    return;
  }
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ itemId: itemId || null }, "", after);
}

function setDetailRouteActive(active) {
  document.body.classList.toggle("detail-route-active", active);
}

function parkDetailCard() {
  if (!(detailCard instanceof HTMLElement)) {
    return;
  }
  if (detailPanel instanceof HTMLElement && detailCard.parentElement !== detailPanel) {
    detailPanel.appendChild(detailCard);
  }
}

function applyDetailModeUi() {
  const inEditMode = currentDetailMode === DETAIL_MODE_EDIT;
  document.body.classList.toggle("detail-edit-mode", inEditMode && Boolean(currentItemId));
  for (const block of browseOnlyBlocks) {
    block.classList.toggle("hidden", inEditMode);
  }
  for (const block of editOnlyBlocks) {
    block.classList.toggle("hidden", !inEditMode);
  }
}

function buildPlatformChips(items) {
  const map = new Map();
  for (const item of items) {
    const platform = normalizeItemPlatform(item);
    if (!map.has(platform.id)) {
      map.set(platform.id, platform.label);
    }
  }

  const chips = [{ id: "all", label: "全部" }];
  for (const [id, label] of [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "zh-Hans-CN"))) {
    chips.push({ id, label });
  }
  return chips;
}

function renderPlatformFilters(items) {
  const chips = buildPlatformChips(items);
  if (!chips.some((chip) => chip.id === currentPlatform)) {
    currentPlatform = "all";
    localStorage.setItem(PLATFORM_KEY, currentPlatform);
  }

  platformFilters.innerHTML = "";
  for (const chip of chips) {
    const button = document.createElement("button");
    button.className = "platform-chip";
    if (chip.id === currentPlatform) {
      button.classList.add("active");
    }
    button.type = "button";
    button.textContent = chip.label;
    button.addEventListener("click", () => {
      currentPlatform = chip.id;
      localStorage.setItem(PLATFORM_KEY, currentPlatform);
      renderItems();
      renderPlatformFilters(currentRawItems);
    });
    platformFilters.appendChild(button);
  }
}

function applyClientFilters(items) {
  const query = searchInput.value.trim().toLowerCase();
  let filtered = [...items];

  if (query) {
    filtered = filtered.filter((item) => {
      const title = itemLabel(item).toLowerCase();
      const sourceUrl = String(item.sourceUrl || "").toLowerCase();
      const domain = String(item.domain || "").toLowerCase();
      const excerpt = sanitizeExcerptText(item.excerpt).toLowerCase();
      const tags = displayTagsOf(item).join(",").toLowerCase();
      return (
        title.includes(query) ||
        sourceUrl.includes(query) ||
        domain.includes(query) ||
        excerpt.includes(query) ||
        tags.includes(query)
      );
    });
  }

  if (currentPlatform !== "all") {
    filtered = filtered.filter((item) => normalizeItemPlatform(item).id === currentPlatform);
  }

  return dedupeItems(filtered);
}

function normalizeLocationLabel(value) {
  const cleaned = String(value || "")
    .replace(SOCIAL_TIME_INLINE_PATTERN, " ")
    .replace(NOISE_INLINE_PATTERN, " ")
    .replace(/[，。！？!?,;:：、]+$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }
  if (cleaned.length < 2 || cleaned.length > 20) {
    return "";
  }
  if (NOISE_WORD_PATTERN.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function locationLabelOf(item) {
  const direct = normalizeLocationLabel(item?.locationLabel);
  if (direct) {
    return direct;
  }
  const text = String(item?.excerpt || "");
  const matched = text.match(
    /(?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天)\s+([A-Za-z\u4e00-\u9fa5·・]{2,20})/u
  );
  return normalizeLocationLabel(matched?.[1] || "");
}

function publishedAtLabelOf(item) {
  const direct = String(item?.publishedAtLabel || "").trim();
  if (direct) {
    return direct;
  }
  const excerpt = String(item?.excerpt || "").trim();
  const matched =
    excerpt.match(/(\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}[:：]\d{2}(?::\d{2})?)?)/u)?.[1] ??
    excerpt.match(/((?:今天|昨天|前天)\s*\d{1,2}[:：]\d{2})/u)?.[1] ??
    excerpt.match(/((?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚))/u)?.[1] ??
    "";
  return String(matched || "").trim();
}

function itemsFingerprint(items) {
  return (items || [])
    .map((item) => {
      const tags = Array.isArray(item?.tags) ? item.tags.join("|") : "";
      const excerpt = sanitizeExcerptText(item?.excerpt || "");
      return [
        item?.id || "",
        item?.status || "",
        item?.archivedAt || "",
        item?.title || "",
        excerpt,
        item?.locationLabel || "",
        item?.publishedAtLabel || "",
        item?.authorAvatarUrl || "",
        item?.coverImageUrl || "",
        String(item?.imageCount || 0),
        String(item?.videoCount || 0),
        previewTokenOf(item, "previewImages"),
        previewTokenOf(item, "previewVideos"),
        tags
      ].join("::");
    })
    .join("||");
}

function dedupeItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = dedupeKeyOf(item);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    const existingTs = Date.parse(existing.updatedAt || existing.createdAt || "");
    const currentTs = Date.parse(item.updatedAt || item.createdAt || "");
    if (!Number.isNaN(currentTs) && (Number.isNaN(existingTs) || currentTs >= existingTs)) {
      map.set(key, item);
    }
  }
  return [...map.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function dedupeKeyOf(item) {
  const candidateUrls = [item.canonicalUrl, item.sourceUrl]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const raw of candidateUrls) {
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      if (XHS_HOST_PATTERN.test(host)) {
        const noteId = extractXhsNoteIdFromPath(parsed.pathname);
        if (noteId) {
          return `xhs-note:${noteId}`;
        }
      }
      parsed.hash = "";
      if (!XHS_HOST_PATTERN.test(host)) {
        const toDelete = new Set();
        parsed.searchParams.forEach((_, key) => {
          const lower = String(key).toLowerCase();
          if (lower.startsWith("utm_") || GENERIC_TRACKING_PARAMS.includes(lower)) {
            toDelete.add(key);
          }
        });
        toDelete.forEach((key) => parsed.searchParams.delete(key));
      } else {
        sanitizeXhsPathInUrl(parsed);
      }
      return `url:${parsed.toString().toLowerCase()}`;
    } catch {
      // keep trying
    }
  }
  return `id:${item.id}`;
}

function extractXhsNoteIdFromPath(pathname) {
  const path = String(pathname || "").toLowerCase();
  const matched =
    path.match(/\/discovery\/item\/([a-z0-9]{10,})/i) ??
    path.match(/\/explore\/([a-z0-9]{10,})/i);
  return matched?.[1] ?? "";
}

function renderItems() {
  const items = applyClientFilters(currentRawItems);
  selectedItemIds.clear();

  parkDetailCard();
  itemsList.innerHTML = "";
  if (items.length === 0) {
    refreshBulkUi();
    itemsList.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "item-card";
    if (currentItemId === item.id) {
      card.classList.add("active");
    }

    const content = document.createElement("div");
    content.className = "item-content";

    const platform = normalizeItemPlatform(item);
    const author = displayAuthor(item);
    const avatarUrl = resolveItemAvatarUrl(item);

    const authorRow = document.createElement("div");
    authorRow.className = "item-author-row";
    const authorLeft = document.createElement("div");
    authorLeft.className = "item-author-left";

    const avatarWrap = document.createElement("span");
    avatarWrap.className = "item-avatar-wrap";
    const avatarEl = document.createElement("span");
    avatarEl.className = "item-avatar";
    renderAvatar(avatarEl, avatarUrl, author);
    const platformEl = document.createElement("span");
    platformEl.className = "item-platform-logo";
    renderPlatformLogo(platformEl, item, platform);
    avatarWrap.appendChild(avatarEl);
    avatarWrap.appendChild(platformEl);
    authorLeft.appendChild(avatarWrap);

    const authorName = document.createElement("span");
    authorName.className = "item-author-name";
    authorName.textContent = author;
    authorLeft.appendChild(authorName);
    authorRow.appendChild(authorLeft);

    const timeEl = document.createElement("span");
    timeEl.className = "item-time";
    const publishedAt = publishedAtLabelOf(item);
    timeEl.textContent = publishedAt || safeDate(item.createdAt);
    authorRow.appendChild(timeEl);
    content.appendChild(authorRow);

    const titleEl = document.createElement("div");
    titleEl.className = "item-title";
    titleEl.appendChild(buildTopicLink(displayTopic(item), item.sourceUrl, "item-title-link"));
    content.appendChild(titleEl);

    const fullExcerpt = cardTextSource(item);
    const excerptPreview = buildCardExcerpt(item);
    const canExpand = excerptPreview.truncated;
    const expanded = expandedItemIds.has(item.id);
    const excerptText = expanded && fullExcerpt ? fullExcerpt : excerptPreview.text;
    if (excerptText) {
      const excerpt = document.createElement("div");
      excerpt.className = "item-excerpt";
      if (expanded) {
        excerpt.classList.add("expanded");
      }
      renderRichTextBlocks(excerpt, excerptText);
      content.appendChild(excerpt);

      if (canExpand) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "item-more-btn";
        more.textContent = expanded ? "收起正文" : "展开查看";
        more.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (expandedItemIds.has(item.id)) {
            expandedItemIds.delete(item.id);
          } else {
            expandedItemIds.add(item.id);
          }
          renderItems();
        });
        content.appendChild(more);
      }
    }

    const previewMedia = previewMediaOf(item);
    if (previewMedia.length > 0) {
      const gallery = document.createElement("div");
      gallery.className = `item-gallery${previewMedia.length === 1 ? " one" : ""}`;
      if (
        platform.id === "douban" &&
        previewMedia.length === 1 &&
        previewMedia[0] &&
        previewMedia[0].mediaType === "image"
      ) {
        gallery.classList.add("douban-poster");
      }
      const viewerSource = previewMedia.map((asset) => ({ ...asset, previewUrl: asset.url, downloadUrl: asset.url }));

      const maxImages = 9;
      const shown = previewMedia.slice(0, maxImages);
      shown.forEach((asset, index) => {
        const cell = document.createElement("div");
        cell.className = "item-gallery-cell";
        cell.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openImageViewer(index, viewerSource);
        });
        if (asset.mediaType === "video") {
          const cover = document.createElement("video");
          cover.className = "item-cover";
          cover.preload = "metadata";
          cover.playsInline = true;
          cover.muted = true;
          cover.autoplay = true;
          cover.loop = true;
          mountMediaWithFallback(cover, asset.sources, () => {
            cell.remove();
          });
          cover.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            openImageViewer(index, viewerSource);
          });
          cell.appendChild(cover);

          const tag = document.createElement("span");
          tag.className = "item-gallery-more";
          tag.textContent = "▶";
          cell.appendChild(tag);
        } else {
          const cover = document.createElement("img");
          cover.className = "item-cover";
          cover.loading = "lazy";
          cover.decoding = "async";
          cover.alt = itemLabel(item);
          mountMediaWithFallback(cover, uniqueMediaSources(asset.sources, item.coverImageUrl), () => {
            cell.remove();
          });
          cell.appendChild(cover);
        }

        if (index === shown.length - 1) {
          const total = Number(item.imageCount) + Number(item.videoCount || 0);
          if (Number.isFinite(total) && total > shown.length) {
            const more = document.createElement("span");
            more.className = "item-gallery-more";
            more.textContent = `+${total - shown.length}`;
            cell.appendChild(more);
          }
        }

        gallery.appendChild(cell);
      });
      content.appendChild(gallery);
    } else if (item.coverImageUrl) {
      const cover = document.createElement("img");
      cover.className = "item-cover";
      cover.loading = "lazy";
      cover.decoding = "async";
      cover.src = item.coverImageUrl;
      cover.alt = itemLabel(item);
      cover.addEventListener("error", () => {
        cover.remove();
      });
      content.appendChild(cover);
    }

    const displayTags = displayTagsOf(item);
    if (displayTags.length > 0) {
      const tagsWrap = document.createElement("div");
      tagsWrap.className = "item-tags";
      for (const tag of displayTags.slice(0, 6)) {
        const chip = document.createElement("span");
        chip.className = "item-tag-chip";
        chip.textContent = `#${tag}`;
        tagsWrap.appendChild(chip);
      }
      content.appendChild(tagsWrap);
    }

    const locationLabel = locationLabelOf(item);
    if (locationLabel) {
      const locationRow = document.createElement("div");
      locationRow.className = "item-location";
      locationRow.textContent = `📍${locationLabel}`;
      content.appendChild(locationRow);
    }

    const metaRow = document.createElement("div");
    metaRow.className = "item-meta-row";
    const trailingMeta = [];
    const trailingPublishedAt = publishedAtLabelOf(item);
    if (trailingPublishedAt) {
      trailingMeta.push(trailingPublishedAt);
    }
    metaRow.innerHTML = `<span class="platform-badge">#${escapeHtml(platform.label)}</span><span class="item-meta">${escapeHtml(
      trailingMeta.join(" · ")
    )}</span>`;
    content.appendChild(metaRow);

    card.addEventListener("click", (event) => {
      if (event.target instanceof Node && detailCard instanceof HTMLElement && detailCard.contains(event.target)) {
        return;
      }
      void openDetail(item.id);
    });

    card.appendChild(content);
    itemsList.appendChild(card);
  }

  refreshBulkUi();
}

async function loadItems({ silentIfUnchanged = false } = {}) {
  let path = "/v1/items?limit=120";
  if (currentFilter === "active") {
    path += "&archived=false";
  } else if (currentFilter === "archived") {
    path += "&archived=true";
  }

  const data = await api(path);
  const fetched = Array.isArray(data) ? data : data.items || [];
  const nextRawItems = mergeItemSummaries(currentRawItems, dedupeItems(fetched));
  hasPendingItems = nextRawItems.some((item) => !item.archivedAt && (item.status === "queued" || item.status === "parsing"));
  const nextFingerprint = itemsFingerprint(nextRawItems);
  const unchanged = nextFingerprint === lastItemsFingerprint;
  currentRawItems = nextRawItems;
  if (!(silentIfUnchanged && unchanged)) {
    lastItemsFingerprint = nextFingerprint;
    refreshSidebarStats(currentRawItems);
    renderPlatformFilters(currentRawItems);
    renderItems();
  }

  const routeItemId = activeDetailRoute();
  if (routeItemId && routeItemId !== currentItemId) {
    void openDetail(routeItemId, { syncRoute: false, replaceRoute: true, mode: activeDetailMode() });
    return !unchanged;
  }
  if (!routeItemId && currentItemId) {
    hideDetail({ syncRoute: false, replaceRoute: true });
  }
  return !unchanged;
}

function syncDetailWithRoute() {
  const routeItemId = activeDetailRoute();
  if (routeItemId) {
    const mode = activeDetailMode();
    if (routeItemId !== currentItemId) {
      void openDetail(routeItemId, { syncRoute: false, mode });
    } else {
      currentDetailMode = mode;
      setDetailRouteActive(true);
      applyDetailModeUi();
      renderDetailAssets();
    }
    return;
  }
  if (currentItemId) {
    hideDetail({ syncRoute: false });
  } else {
    setDetailRouteActive(false);
  }
}

function renderSummary(data) {
  currentSummaryStatus = data.status || "idle";
  const keyPoints = Array.isArray(data.keyPoints) ? data.keyPoints.filter((x) => typeof x === "string" && x.trim()) : [];
  const text = typeof data.summaryText === "string" ? data.summaryText.trim() : "";
  const error = typeof data.error === "string" ? data.error.trim() : "";

  summaryStatus.textContent = summaryStatusText(currentSummaryStatus, error);
  summaryPoints.innerHTML = "";

  if (keyPoints.length > 0) {
    for (const point of keyPoints) {
      const li = document.createElement("li");
      li.textContent = point;
      summaryPoints.appendChild(li);
    }
    summaryPoints.classList.remove("hidden");
  } else {
    summaryPoints.classList.add("hidden");
  }

  if (text) {
    summaryText.textContent = text;
    summaryText.classList.remove("hidden");
  } else {
    summaryText.textContent = "";
    summaryText.classList.add("hidden");
  }

  const shouldDisable = !currentItemId || currentSummaryStatus === "queued" || currentSummaryStatus === "running";
  generateSummaryBtn.disabled = shouldDisable;
  generateSummaryBtn.textContent = currentSummaryStatus === "ready" ? "重新生成" : "生成摘要";
}

function summaryStatusText(status, error) {
  switch (status) {
    case "queued":
      return "摘要任务已加入队列，正在等待执行...";
    case "running":
      return "摘要生成中，请稍候...";
    case "ready":
      return "摘要已生成";
    case "failed":
      return error ? `摘要失败：${error}` : "摘要失败，请重试";
    default:
      return "尚未生成摘要";
  }
}

function parserStatusText(status) {
  switch (status) {
    case "queued":
      return "已入队，等待解析";
    case "running":
      return "解析执行中";
    case "done":
      return "最近一次解析成功";
    case "failed":
      return "最近一次解析失败";
    default:
      return "尚未创建解析任务";
  }
}

function parserProgressOf(status, diagnostics) {
  const normalizedStatus = String(status || "idle");
  const attempts = Number(diagnostics?.attempts || 0);
  if (Number.isFinite(Number(diagnostics?.progress))) {
    const fromServer = Number(diagnostics.progress);
    return Math.max(0, Math.min(100, fromServer));
  }
  if (normalizedStatus === "queued") {
    return 12;
  }
  if (normalizedStatus === "running" || normalizedStatus === "parsing") {
    return Math.min(95, 45 + Math.max(0, attempts) * 15);
  }
  if (normalizedStatus === "ready" || normalizedStatus === "done" || normalizedStatus === "failed") {
    return 100;
  }
  return 0;
}

function parserProgressLabel(status, diagnostics) {
  const normalizedStatus = String(status || "idle");
  if (normalizedStatus === "queued") {
    return "任务排队中";
  }
  if (normalizedStatus === "running" || normalizedStatus === "parsing") {
    return "正在抓取与解析";
  }
  if (normalizedStatus === "ready" || normalizedStatus === "done") {
    return "抓取完成";
  }
  if (normalizedStatus === "failed") {
    return diagnostics?.errorMessage ? "抓取失败" : "解析失败";
  }
  return "等待中";
}

function renderDiagnosticsProgress(progress) {
  if (!(diagnosticsProgress instanceof HTMLElement) || !(diagnosticsProgressBar instanceof HTMLElement)) {
    return;
  }
  const normalized = Math.max(0, Math.min(100, Number(progress) || 0));
  diagnosticsProgress.classList.toggle("hidden", normalized <= 0 || normalized >= 100);
  diagnosticsProgressBar.style.width = `${normalized}%`;
  diagnosticsProgress.setAttribute("aria-valuenow", String(Math.round(normalized)));
}

function mediaFilterSummaryText(summary) {
  if (!summary || typeof summary !== "object") {
    return "";
  }
  const totalAssets = Number(summary.totalAssets || 0);
  const visibleAssets = Number(summary.visibleAssets || 0);
  const filteredAssets = Number(summary.filteredAssets || 0);
  const byNoise = Number(summary.filteredByNoiseUrl || 0);
  const byBlocked = Number(summary.filteredByBlockedContent || 0);
  const blockedContent = summary.blockedContent === true;
  const fragments = [];
  if (totalAssets > 0) {
    fragments.push(`资源可见 ${visibleAssets}/${totalAssets}`);
  }
  if (filteredAssets > 0) {
    fragments.push(`过滤 ${filteredAssets}`);
  }
  if (byNoise > 0 || byBlocked > 0) {
    fragments.push(`噪音 ${byNoise} · 风控图 ${byBlocked}`);
  }
  if (blockedContent) {
    fragments.push("疑似命中风控页文本");
  }
  return fragments.join(" · ");
}

function renderParserDiagnostics(data) {
  currentParserDiagnostics = data && typeof data === "object" ? data : null;
  if (!diagnosticsStatus) {
    return;
  }
  if (!currentParserDiagnostics) {
    renderDiagnosticsProgress(0);
    diagnosticsStatus.textContent = "暂无诊断数据";
    return;
  }
  const status = String(currentParserDiagnostics.status || "idle");
  const attempts = Number(currentParserDiagnostics.attempts || 0);
  const progress = parserProgressOf(status, currentParserDiagnostics);
  const updatedAt = currentParserDiagnostics.updatedAt ? safeDate(currentParserDiagnostics.updatedAt) : "--";
  const error = String(currentParserDiagnostics.errorMessage || "").trim();
  const filterSummary = mediaFilterSummaryText(currentParserDiagnostics.mediaFilterSummary);
  renderDiagnosticsProgress(progress);
  const baseText =
    `${parserStatusText(status)} · ${Math.round(progress)}% · 重试 ${attempts} 次 · 更新时间 ${updatedAt}` +
    (error ? ` · 错误：${error}` : "");
  diagnosticsStatus.textContent = filterSummary ? `${baseText}\n${filterSummary}` : baseText;
}

function detailPlaceholder(status) {
  if (status === "failed") {
    return "解析失败，请稍后重试或检查链接是否可访问。";
  }
  if (status === "queued" || status === "parsing") {
    return "内容正在解析中，页面会自动刷新状态。";
  }
  return "该条目暂无可展示内容。";
}

function renderNotes() {
  if (!notesList) {
    return;
  }
  notesList.innerHTML = "";
  for (const note of currentNotes) {
    const card = document.createElement("article");
    card.className = "note-card";

    const body = document.createElement("p");
    body.className = "note-body";
    body.textContent = String(note.bodyMd || "").trim();

    const meta = document.createElement("span");
    meta.className = "note-meta-corner";
    meta.textContent = safeDate(note.updatedAt || note.createdAt).replace(" ", "\n");

    card.appendChild(body);
    card.appendChild(meta);
    notesList.appendChild(card);
  }
}

async function loadNotes(itemId) {
  try {
    const data = await api(`/v1/items/${itemId}/notes`);
    currentNotes = Array.isArray(data) ? data : [];
  } catch {
    currentNotes = [];
  }
  renderNotes();
}

async function createNote(event) {
  event.preventDefault();
  if (!currentItemId) {
    return;
  }

  const bodyMd = String(noteBodyInput?.value || "").trim();
  if (!bodyMd) {
    setCreateStatus("请先输入灵感笔记内容", true);
    return;
  }

  try {
    await api(`/v1/items/${currentItemId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bodyMd
      })
    });
    if (noteBodyInput) {
      noteBodyInput.value = "";
    }
    setCreateStatus("已新增灵感笔记");
    await loadNotes(currentItemId);
  } catch (error) {
    setCreateStatus(`新增笔记失败: ${errorMessage(error)}`, true);
  }
}

async function openDetail(itemId, { syncRoute = true, replaceRoute = false, mode = DETAIL_MODE_BROWSE } = {}) {
  let item;
  try {
    item = await api(`/v1/items/${itemId}`);
  } catch {
    if (currentItemId === itemId) {
      hideDetail({ syncRoute });
    }
    return;
  }

  currentItemId = itemId;
  currentItem = item;
  currentDetailMode = mode;
  setDetailRouteActive(true);
  applyDetailModeUi();
  if (syncRoute) {
    updateDetailRoute(itemId, { replace: replaceRoute, mode: currentDetailMode });
  }
  detailEmpty.classList.add("hidden");
  detailCard.classList.remove("hidden");

  const author = displayAuthor(item);
  const avatarUrl = resolveItemAvatarUrl(item);
  const platform = normalizeItemPlatform(item);
  detailTitle.innerHTML = "";
  detailTitle.appendChild(buildTopicLink(displayTopic(item), item.sourceUrl, "detail-title-link"));
  detailDomain.textContent = author;
  renderAvatar(detailAvatar, avatarUrl, author);
  if (detailPlatformLogo) {
    renderPlatformLogo(detailPlatformLogo, item, platform);
  }
  if (detailCreatedAt) {
    const locationLabel = locationLabelOf(item);
    const publishedAt = publishedAtLabelOf(item);
    const dateText = publishedAt || safeDate(item.createdAt);
    detailCreatedAt.textContent = locationLabel ? `${dateText} · 📍${locationLabel}` : dateText;
  }
  detailStatus.className = "platform-badge";
  detailStatus.textContent = `#${platform.label}`;

  currentDetailArchived = Boolean(item.archivedAt);
  if (archiveBtn) {
    archiveBtn.classList.toggle("hidden", currentDetailArchived);
  }
  if (restoreBtn) {
    restoreBtn.classList.toggle("hidden", !currentDetailArchived);
  }

  if (detailUrl) {
    detailUrl.textContent = "";
    detailUrl.href = "#";
    detailUrl.classList.add("hidden");
  }
  const normalizedDetailText =
    item.plainText && item.plainText.trim().length > 0
      ? sanitizeExcerptText(item.plainText, { preserveNewlines: true })
      : "";
  currentDetailText = normalizedDetailText || String(item.excerpt || "").trim() || displayTopic(item) || detailPlaceholder(item.status);
  currentDetailAssets = Array.isArray(item.assets) ? item.assets : [];

  detailEditTitle.value = item.title || "";
  detailEditTags.value = displayTagsOf(item).join(", ");

  renderSummary({
    status: item.summaryStatus || "idle",
    summaryText: item.summaryText || "",
    keyPoints: Array.isArray(item.summaryKeyPoints) ? item.summaryKeyPoints : [],
    error: item.summaryError || ""
  });
  renderParserDiagnostics(item.parserDiagnostics);

  renderDetailAssets();
  renderDetailContent();
  await loadNotes(itemId);
  renderItems();
}

function hideDetail({ syncRoute = true, replaceRoute = false } = {}) {
  currentItemId = null;
  currentItem = null;
  currentDetailText = "";
  currentDetailAssets = [];
  currentDetailArchived = false;
  currentDetailMode = DETAIL_MODE_BROWSE;
  currentNotes = [];
  currentParserDiagnostics = null;
  renderSummary({ status: "idle", summaryText: "", keyPoints: [], error: "" });
  renderParserDiagnostics(null);
  renderNotes();
  renderDetailAssets();
  detailCard.classList.add("hidden");
  detailEmpty.classList.remove("hidden");
  setDetailRouteActive(false);
  applyDetailModeUi();
  if (syncRoute) {
    updateDetailRoute(null, { replace: replaceRoute, mode: DETAIL_MODE_BROWSE });
  }
  renderItems();
}

function switchDetailMode(mode, { replaceRoute = false } = {}) {
  if (!currentItemId) {
    return;
  }
  currentDetailMode = mode === DETAIL_MODE_EDIT ? DETAIL_MODE_EDIT : DETAIL_MODE_BROWSE;
  applyDetailModeUi();
  renderDetailAssets();
  updateDetailRoute(currentItemId, { replace: replaceRoute, mode: currentDetailMode });
}

function renderDetailContent() {
  const text = String(currentDetailText || "").trim();
  if (!text) {
    detailContent.innerHTML = "";
    return;
  }
  const blocks = text
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line).replaceAll("\n", "<br/>")}</p>`);
  detailContent.innerHTML = blocks.join("");
}

function imageAssets() {
  return currentDetailAssets.filter((asset) => asset && asset.type === "image");
}

function videoAssets() {
  return currentDetailAssets.filter((asset) => asset && asset.type === "video");
}

function detailMediaAssets() {
  return currentDetailAssets
    .filter((asset) => asset && (asset.type === "image" || asset.type === "video"))
    .sort((a, b) => {
      const sortA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
      const sortB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
      if (sortA !== sortB) {
        return sortA - sortB;
      }
      if (a.type === b.type) {
        return 0;
      }
      return a.type === "image" ? -1 : 1;
    });
}

function renderDetailAssets() {
  const media = detailMediaAssets();
  if (media.length === 0) {
    detailAssetsSection.classList.add("hidden");
    if (detailAssetsMeta) {
      detailAssetsMeta.textContent = "";
    }
    detailAssetsGrid.innerHTML = "";
    return;
  }

  detailAssetsSection.classList.remove("hidden");
  if (detailAssetsMeta) {
    detailAssetsMeta.textContent = "";
  }
  detailAssetsGrid.innerHTML = "";

  const viewerSource = media.map((asset) => ({ ...asset, mediaType: asset.type }));
  media.slice(0, 27).forEach((asset, index) => {
    const card = document.createElement("div");
    card.className = "item-gallery-cell detail-media-cell";

    if (asset.type === "image") {
      const image = document.createElement("img");
      image.className = "item-cover";
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = "captured image";
      mountMediaWithFallback(image, [asset.previewUrl, asset.downloadUrl, asset.url], () => {
        card.remove();
      });
      image.addEventListener("click", () => openImageViewer(index, viewerSource));
      card.appendChild(image);
    } else {
      const video = document.createElement("video");
      video.className = "item-cover";
      video.preload = "metadata";
      video.playsInline = true;
      video.muted = true;
      mountMediaWithFallback(video, [asset.previewUrl, asset.downloadUrl, asset.url], () => {
        card.remove();
      });
      video.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openImageViewer(index, viewerSource);
      });
      card.appendChild(video);
    }

    if (currentDetailMode === DETAIL_MODE_EDIT) {
      const link = document.createElement("a");
      link.className = "asset-download detail-media-download";
      link.href = asset.downloadUrl || asset.previewUrl || asset.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = "下载";
      card.appendChild(link);
    }
    detailAssetsGrid.appendChild(card);
  });
}

function openImageViewer(index, sourceAssets = null) {
  const source = Array.isArray(sourceAssets) && sourceAssets.length > 0 ? sourceAssets : detailMediaAssets();
  viewerAssets = source.map((asset) => ({
    mediaType: asset.mediaType || asset.type || "image",
    previewUrl: asset.previewUrl,
    downloadUrl: asset.downloadUrl,
    url: asset.url,
    width: asset.width,
    height: asset.height
  }));
  if (viewerAssets.length === 0) {
    return;
  }
  viewerIndex = Math.max(0, Math.min(index, viewerAssets.length - 1));
  renderImageViewer();
  imageViewer.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeImageViewer() {
  imageViewer.classList.add("hidden");
  if (imageViewerVideo instanceof HTMLVideoElement) {
    imageViewerVideo.pause();
    imageViewerVideo.removeAttribute("src");
    imageViewerVideo.load();
  }
  document.body.style.overflow = "";
}

function renderImageViewer() {
  if (viewerIndex < 0 || viewerIndex >= viewerAssets.length) {
    return;
  }
  const asset = viewerAssets[viewerIndex];
  const source = asset.previewUrl || asset.downloadUrl || asset.url;
  const mediaType = asset.mediaType === "video" ? "video" : "image";

  if (mediaType === "video") {
    imageViewerImg.classList.add("hidden");
    if (imageViewerVideo instanceof HTMLVideoElement) {
      imageViewerVideo.classList.remove("hidden");
      imageViewerVideo.controls = true;
      imageViewerVideo.src = source;
      imageViewerVideo.muted = false;
      imageViewerVideo.onerror = () => {
        setCreateStatus("视频加载失败，请稍后重试或直接下载查看", true);
      };
      imageViewerVideo.play().catch(() => {
        // user gesture policies may block autoplay in some browsers
      });
    }
  } else {
    if (imageViewerVideo instanceof HTMLVideoElement) {
      imageViewerVideo.pause();
      imageViewerVideo.classList.add("hidden");
      imageViewerVideo.onerror = null;
    }
    imageViewerImg.classList.remove("hidden");
    imageViewerImg.onerror = () => {
      setCreateStatus("媒体加载失败，已关闭预览", true);
      closeImageViewer();
    };
    imageViewerImg.src = source;
  }

  const sizeMeta =
    Number.isFinite(Number(asset.width)) && Number.isFinite(Number(asset.height)) ? ` · ${asset.width}x${asset.height}` : "";
  imageViewerMeta.textContent = `${viewerIndex + 1} / ${viewerAssets.length} · ${mediaType === "video" ? "视频" : "图片"}${sizeMeta}`;
}

function moveImage(step) {
  if (viewerAssets.length === 0) {
    return;
  }
  viewerIndex = (viewerIndex + step + viewerAssets.length) % viewerAssets.length;
  renderImageViewer();
}

async function submitCapture() {
  const sourceUrl = tryExtractCaptureUrl(sourceUrlInput.value, { setFieldValue: true });
  if (!sourceUrl) {
    setCreateStatus("未识别到有效链接，请粘贴链接或分享文案", true);
    return;
  }

  setCreateStatus("保存中...");
  setCaptureProgress(4, "正在创建任务");
  try {
    const payload = {
      sourceUrl,
      titleHint: titleHintInput.value.trim() || undefined,
      tags: parseTags(tagsInput.value)
    };
    const result = await api("/v1/captures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    sourceUrlInput.value = "";
    titleHintInput.value = "";
    tagsInput.value = "";
    setCreateStatus("已保存，正在解析");
    setCaptureProgress(12, "任务已入队");
    closeCaptureModal();

    if (currentFilter !== "active" && currentFilter !== "all") {
      currentFilter = "active";
      localStorage.setItem(FILTER_KEY, currentFilter);
      refreshFilterUi();
    }

    hideDetail({ syncRoute: true, replaceRoute: true });
    await loadItems();
    const finalStatus = await pollUntilSettled(result.itemId, ({ status, diagnostics }) => {
      const progress = parserProgressOf(status, diagnostics);
      const label = parserProgressLabel(status, diagnostics);
      setCaptureProgress(progress, label);
    });
    await loadItems();
    if (finalStatus === "ready") {
      setCreateStatus("抓取完成");
      setCaptureProgress(100, "抓取完成");
    } else if (finalStatus === "failed") {
      setCreateStatus("抓取失败，请在详情页点击“重新解析”重试", true);
      setCaptureProgress(100, "抓取失败");
    }
    setTimeout(() => {
      clearCaptureProgress();
    }, 1400);
  } catch (error) {
    clearCaptureProgress();
    setCreateStatus(errorMessage(error), true);
  }
}

async function createCapture(event) {
  event.preventDefault();
  await submitCapture();
}

async function pollUntilSettled(itemId, onProgress) {
  let latestStatus = "queued";
  for (let i = 0; i < 20; i += 1) {
    const detail = await api(`/v1/items/${itemId}`);
    latestStatus = String(detail?.status || latestStatus);
    if (typeof onProgress === "function") {
      onProgress({
        status: latestStatus,
        diagnostics: detail?.parserDiagnostics || null
      });
    }
    if (latestStatus === "ready" || latestStatus === "failed") {
      return latestStatus;
    }
    await sleep(1500);
  }
  return latestStatus;
}

async function archiveCurrentItem() {
  if (!currentItemId || currentDetailArchived) {
    return;
  }
  const ok = window.confirm("确认归档这条收藏吗？");
  if (!ok) {
    return;
  }

  const itemId = currentItemId;
  try {
    await api(`/v1/items/${itemId}`, { method: "DELETE" });
    selectedItemIds.delete(itemId);
    setCreateStatus("已归档");
    if (currentFilter === "active") {
      hideDetail();
    }
    await loadItems();
  } catch (error) {
    setCreateStatus(`归档失败: ${errorMessage(error)}`, true);
  }
}

async function restoreCurrentItem() {
  if (!currentItemId || !currentDetailArchived) {
    return;
  }

  const itemId = currentItemId;
  try {
    await api(`/v1/items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: false })
    });
    selectedItemIds.delete(itemId);
    setCreateStatus("已恢复");
    if (currentFilter === "archived") {
      hideDetail();
    }
    await loadItems();
    await openDetail(itemId, { mode: currentDetailMode });
  } catch (error) {
    setCreateStatus(`恢复失败: ${errorMessage(error)}`, true);
  }
}

async function saveDetailEdits() {
  if (!currentItemId) {
    return;
  }

  const payload = {
    title: detailEditTitle.value.trim() || undefined,
    tags: uniq(parseTags(detailEditTags.value))
  };

  try {
    await api(`/v1/items/${currentItemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    setCreateStatus("已保存修改");
    const itemId = currentItemId;
    await loadItems();
    await openDetail(itemId, { mode: currentDetailMode });
  } catch (error) {
    setCreateStatus(`保存失败: ${errorMessage(error)}`, true);
  }
}

async function deleteCurrentItemPermanently() {
  if (!currentItemId) {
    return;
  }
  const ok = window.confirm("确认永久删除这条收藏吗？删除后不可恢复。");
  if (!ok) {
    return;
  }

  const itemId = currentItemId;
  try {
    await api(`/v1/items/${itemId}/permanent`, { method: "DELETE" });
    selectedItemIds.delete(itemId);
    hideDetail();
    setCreateStatus("已永久删除");
    await loadItems();
  } catch (error) {
    setCreateStatus(`删除失败: ${errorMessage(error)}`, true);
  }
}

async function generateSummary() {
  if (!currentItemId) {
    return;
  }

  try {
    generateSummaryBtn.disabled = true;
    const result = await api(`/v1/items/${currentItemId}/summary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: currentSummaryStatus === "ready" })
    });
    renderSummary({
      status: result?.status || "queued",
      summaryText: result?.summaryText || "",
      keyPoints: Array.isArray(result?.keyPoints) ? result.keyPoints : [],
      error: result?.error || ""
    });
    setCreateStatus("摘要任务已提交");
    await openDetail(currentItemId, { mode: currentDetailMode });
  } catch (error) {
    setCreateStatus(`摘要生成失败: ${errorMessage(error)}`, true);
    generateSummaryBtn.disabled = false;
  }
}

async function refreshParserDiagnostics() {
  if (!currentItemId) {
    return;
  }
  try {
    const result = await api(`/v1/items/${currentItemId}/diagnostics`);
    renderParserDiagnostics(result);
  } catch (error) {
    setCreateStatus(`刷新解析诊断失败: ${errorMessage(error)}`, true);
  }
}

async function requestCurrentItemReparse() {
  if (!currentItemId) {
    return;
  }
  const itemId = currentItemId;
  try {
    if (reparseBtn) {
      reparseBtn.disabled = true;
    }
    const result = await api(`/v1/items/${itemId}/reparse`, {
      method: "POST"
    });
    renderParserDiagnostics(result);
    setCreateStatus("已提交重新解析任务");
    await loadItems({ silentIfUnchanged: true });
    if (currentItemId === itemId) {
      await openDetail(itemId, { mode: currentDetailMode });
    }
  } catch (error) {
    setCreateStatus(`重新解析失败: ${errorMessage(error)}`, true);
  } finally {
    if (reparseBtn) {
      reparseBtn.disabled = false;
    }
  }
}

async function runBatchOperation(itemIds, label, operation) {
  let success = 0;
  const failed = [];
  for (let i = 0; i < itemIds.length; i += 1) {
    const id = itemIds[i];
    setCreateStatus(`${label}中 ${i + 1}/${itemIds.length}（成功 ${success}）...`);
    try {
      await operation(id);
      success += 1;
    } catch (error) {
      failed.push({ id, reason: errorMessage(error) });
    }
  }

  if (failed.length > 0) {
    console.warn(`${label} failures`, failed);
  }
  return { success, failed };
}

function batchSummaryText(label, success, total, failed) {
  if (failed.length === 0) {
    return `${label}完成: ${success}/${total}`;
  }
  const preview = failed
    .slice(0, 3)
    .map((x) => `${x.id.slice(0, 8)}(${x.reason})`)
    .join(", ");
  const more = failed.length > 3 ? ` ... 另有 ${failed.length - 3} 项失败` : "";
  return `${label}完成: ${success}/${total}，失败 ${failed.length} 项：${preview}${more}`;
}

async function bulkArchiveSelected() {
  const ids = Array.from(selectedItemIds);
  if (ids.length === 0) {
    return;
  }
  const ok = window.confirm(`确认批量归档 ${ids.length} 项吗？`);
  if (!ok) {
    return;
  }

  const result = await runBatchOperation(ids, "批量归档", async (id) => {
    await api(`/v1/items/${id}`, { method: "DELETE" });
  });

  if (currentItemId && selectedItemIds.has(currentItemId) && currentFilter === "active") {
    hideDetail();
  }
  selectedItemIds.clear();
  setCreateStatus(batchSummaryText("批量归档", result.success, ids.length, result.failed));
  await loadItems();
}

async function bulkRestoreSelected() {
  const ids = Array.from(selectedItemIds);
  if (ids.length === 0) {
    return;
  }
  const ok = window.confirm(`确认批量恢复 ${ids.length} 项吗？`);
  if (!ok) {
    return;
  }

  const result = await runBatchOperation(ids, "批量恢复", async (id) => {
    await api(`/v1/items/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: false })
    });
  });

  if (currentItemId && selectedItemIds.has(currentItemId) && currentFilter === "archived") {
    hideDetail();
  }
  selectedItemIds.clear();
  setCreateStatus(batchSummaryText("批量恢复", result.success, ids.length, result.failed));
  await loadItems();
}

async function purgeArchivedAll() {
  const ok = window.confirm("确认清空所有已归档条目吗？此操作会永久删除。");
  if (!ok) {
    return;
  }

  try {
    setCreateStatus("正在清空已归档...");
    const result = await api("/v1/items/purge-archived", { method: "POST" });
    const deletedCount = Number(result?.deletedCount ?? 0);
    if (currentDetailArchived) {
      hideDetail();
    }
    selectedItemIds.clear();
    setCreateStatus(`已清空 ${deletedCount} 条已归档内容`);
    await loadItems();
  } catch (error) {
    setCreateStatus(`清空失败: ${errorMessage(error)}`, true);
  }
}

async function autoRefreshTick() {
  if (isAutoRefreshing || document.hidden) {
    return;
  }
  if (!hasPendingItems) {
    return;
  }

  isAutoRefreshing = true;
  try {
    const prevDetailSummary = currentItemId ? currentRawItems.find((item) => item.id === currentItemId) : null;
    const changed = await loadItems({ silentIfUnchanged: true });
    const nextDetailSummary = currentItemId ? currentRawItems.find((item) => item.id === currentItemId) : null;
    const prevPending =
      prevDetailSummary && (prevDetailSummary.status === "queued" || prevDetailSummary.status === "parsing");
    const nextPending =
      nextDetailSummary && (nextDetailSummary.status === "queued" || nextDetailSummary.status === "parsing");
    const shouldRefreshDetail =
      Boolean(changed && currentItemId) &&
      Boolean(nextDetailSummary) &&
      (prevPending !== nextPending ||
        prevDetailSummary?.status !== nextDetailSummary?.status ||
        Number(prevDetailSummary?.imageCount || 0) !== Number(nextDetailSummary?.imageCount || 0) ||
        Number(prevDetailSummary?.videoCount || 0) !== Number(nextDetailSummary?.videoCount || 0));
    if (shouldRefreshDetail) {
      await openDetail(currentItemId, { mode: currentDetailMode, syncRoute: false });
    }
  } finally {
    isAutoRefreshing = false;
  }
}

function errorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isIosDevice() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua);
}

function isIosChrome() {
  return /CriOS/i.test(navigator.userAgent || "");
}

function isIosSafari() {
  const ua = navigator.userAgent || "";
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
}

function registerPwa() {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches;
  if (isStandalone && installBtn) {
    installBtn.classList.add("hidden");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/app/service-worker.js", { scope: "/app/" }).catch(() => {
      // ignore registration failures
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installBtn) {
      installBtn.textContent = "安装到桌面";
      installBtn.classList.remove("hidden");
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installBtn) {
      installBtn.classList.add("hidden");
    }
  });

  if (installBtn && !isStandalone && isIosDevice()) {
    installBtn.textContent = "安装指引";
    installBtn.classList.remove("hidden");
  }
}

async function installPwa() {
  if (!deferredInstallPrompt) {
    if (isIosChrome()) {
      setCreateStatus("iPhone Chrome 无法直接触发安装，请在 Safari 打开后“添加到主屏幕”", true);
      return;
    }
    if (isIosSafari()) {
      setCreateStatus("请在 Safari 的分享菜单中选择“添加到主屏幕”", true);
      return;
    }
    setCreateStatus("请在浏览器菜单中选择“安装应用”或“添加到桌面”", true);
    return;
  }
  deferredInstallPrompt.prompt();
  try {
    await deferredInstallPrompt.userChoice;
  } catch {
    // ignore
  }
  deferredInstallPrompt = null;
  installBtn.classList.add("hidden");
}

captureForm.addEventListener("submit", (event) => {
  void createCapture(event);
});

if (quickCaptureBtn) {
  quickCaptureBtn.addEventListener("click", () => {
    void quickCaptureFlow();
  });
}

if (captureModalCloseBtn) {
  captureModalCloseBtn.addEventListener("click", () => {
    closeCaptureModal();
  });
}

if (captureCancelBtn) {
  captureCancelBtn.addEventListener("click", () => {
    closeCaptureModal();
  });
}

if (captureModal) {
  captureModal.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.classList.contains("capture-modal-mask")) {
      closeCaptureModal();
    }
  });
}

if (accountModal) {
  accountModal.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.classList.contains("capture-modal-mask")) {
      closeAccountModal();
    }
  });
}

if (accountModalCloseBtn) {
  accountModalCloseBtn.addEventListener("click", () => {
    closeAccountModal();
  });
}

if (accountRequestCodeBtn) {
  accountRequestCodeBtn.addEventListener("click", () => {
    void requestAuthCode();
  });
}

if (accountLoginForm) {
  accountLoginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void verifyAuthCodeAndLogin();
  });
}

if (accountLogoutBtn) {
  accountLogoutBtn.addEventListener("click", () => {
    logoutAuthSession();
  });
}

if (billingRefreshBtn) {
  billingRefreshBtn.addEventListener("click", () => {
    void refreshBillingState();
  });
}

if (billingSubscribeBtn) {
  billingSubscribeBtn.addEventListener("click", () => {
    void subscribeProPlan();
  });
}

if (billingCancelBtn) {
  billingCancelBtn.addEventListener("click", () => {
    void cancelSubscription();
  });
}

if (pasteDetectBtn) {
  pasteDetectBtn.addEventListener("click", () => {
    void (async () => {
      const extracted = await detectClipboardUrl();
      if (extracted) {
        return;
      }
      const manualText = promptManualShareText();
      if (!manualText) {
        return;
      }
      const manualUrl = tryExtractCaptureUrl(manualText, { setFieldValue: true });
      if (manualUrl) {
        setCreateStatus("已识别手动粘贴内容中的链接");
      } else {
        sourceUrlInput.value = manualText;
        setCreateStatus("请检查并手动修正链接后保存", true);
      }
    })();
  });
}

sourceUrlInput.addEventListener("paste", (event) => {
  const pasted = event.clipboardData?.getData("text");
  if (!pasted) {
    return;
  }
  const extracted = tryExtractCaptureUrl(pasted, { setFieldValue: true });
  if (!extracted) {
    return;
  }
  event.preventDefault();
  setCreateStatus("已自动识别粘贴内容中的链接");
});

sourceUrlInput.addEventListener("focus", () => {
  if (sourceUrlInput.value.trim()) {
    return;
  }
  void detectClipboardUrl({ silent: true });
});

refreshBtn.addEventListener("click", async () => {
  await loadItems();
  if (currentItemId) {
    await openDetail(currentItemId, { mode: currentDetailMode });
  }
});

if (accountSettingsBtn) {
  accountSettingsBtn.addEventListener("click", () => {
    void openAccountModal();
  });
}

if (installBtn) {
  installBtn.addEventListener("click", () => {
    void installPwa();
  });
}

if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener("click", () => {
    setSidebarCollapsed(!sidebarCollapsed);
  });
}

searchBtn.addEventListener("click", renderItems);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    renderItems();
  }
});

if (backToTopBtn) {
  backToTopBtn.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });
}

listFilters.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest(".filter-btn");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const next = button.dataset.filter;
  if (!next || next === currentFilter) {
    return;
  }
  currentFilter = next;
  localStorage.setItem(FILTER_KEY, currentFilter);
  refreshFilterUi();
  selectedItemIds.clear();
  hideDetail();
  void loadItems();
});

if (archiveBtn) {
  archiveBtn.addEventListener("click", () => {
    void archiveCurrentItem();
  });
}
if (restoreBtn) {
  restoreBtn.addEventListener("click", () => {
    void restoreCurrentItem();
  });
}
if (detailCloseBtn) {
  detailCloseBtn.addEventListener("click", () => {
    hideDetail();
  });
}
if (detailCard) {
  detailCard.addEventListener("click", (event) => {
    event.stopPropagation();
  });
}
saveDetailBtn.addEventListener("click", () => {
  void saveDetailEdits();
});
if (reparseBtn) {
  reparseBtn.addEventListener("click", () => {
    void requestCurrentItemReparse();
  });
}
deleteDetailBtn.addEventListener("click", () => {
  void deleteCurrentItemPermanently();
});
if (toolbarSaveBtn) {
  toolbarSaveBtn.addEventListener("click", () => {
    void saveDetailEdits();
  });
}
if (toolbarReparseBtn) {
  toolbarReparseBtn.addEventListener("click", () => {
    void requestCurrentItemReparse();
  });
}
if (toolbarDeleteBtn) {
  toolbarDeleteBtn.addEventListener("click", () => {
    void deleteCurrentItemPermanently();
  });
}
if (toolbarCancelBtn) {
  toolbarCancelBtn.addEventListener("click", () => {
    switchDetailMode(DETAIL_MODE_BROWSE);
  });
}
generateSummaryBtn.addEventListener("click", () => {
  void generateSummary();
});

if (goEditBtn) {
  goEditBtn.addEventListener("click", () => {
    switchDetailMode(DETAIL_MODE_EDIT);
  });
}

if (backBrowseBtn) {
  backBrowseBtn.addEventListener("click", () => {
    switchDetailMode(DETAIL_MODE_BROWSE);
  });
}

if (refreshDiagnosticsBtn) {
  refreshDiagnosticsBtn.addEventListener("click", () => {
    void refreshParserDiagnostics();
  });
}

if (noteForm) {
  noteForm.addEventListener("submit", (event) => {
    void createNote(event);
  });
}

imageViewerClose.addEventListener("click", closeImageViewer);
imageViewerPrev.addEventListener("click", () => moveImage(-1));
imageViewerNext.addEventListener("click", () => moveImage(1));
imageViewer.addEventListener("click", (event) => {
  if (event.target === imageViewer) {
    closeImageViewer();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && captureModal && !captureModal.classList.contains("hidden")) {
    closeCaptureModal();
    return;
  }
  if (event.key === "Escape" && accountModal && !accountModal.classList.contains("hidden")) {
    closeAccountModal();
    return;
  }
  if (imageViewer.classList.contains("hidden")) {
    return;
  }
  if (event.key === "Escape") {
    closeImageViewer();
  }
  if (event.key === "ArrowLeft") {
    moveImage(-1);
  }
  if (event.key === "ArrowRight") {
    moveImage(1);
  }
});

window.addEventListener("resize", () => {
  if (resizeRaf) {
    window.cancelAnimationFrame(resizeRaf);
  }
  resizeRaf = window.requestAnimationFrame(() => {
    resizeRaf = 0;
    updateLayoutOffsets();
    const width = window.innerWidth;
    if (Math.abs(width - lastViewportWidth) < 40) {
      return;
    }
    lastViewportWidth = width;
    setSidebarCollapsed(sidebarCollapsed);
    renderItems();
    if (currentItemId) {
      renderDetailAssets();
    }
  });
});

window.addEventListener("scroll", () => {
  rememberListScroll();
  toggleBackToTop();
}, { passive: true });

window.addEventListener("beforeunload", () => {
  sessionStorage.setItem(LIST_SCROLL_KEY, String(window.scrollY || 0));
});

imageViewer.addEventListener("touchstart", (event) => {
  touchStartX = event.touches[0]?.clientX ?? null;
});

imageViewer.addEventListener("touchend", (event) => {
  if (touchStartX === null) {
    return;
  }
  const endX = event.changedTouches[0]?.clientX ?? touchStartX;
  const delta = endX - touchStartX;
  touchStartX = null;
  if (Math.abs(delta) < 40) {
    return;
  }
  moveImage(delta > 0 ? -1 : 1);
});

refreshFilterUi();
refreshBulkUi();
clearCaptureProgress();
updateLayoutOffsets();
setSidebarCollapsed(sidebarCollapsed);
refreshSidebarStats([]);
renderAccountUi();
toggleBackToTop();
registerPwa();
window.addEventListener("popstate", () => {
  syncDetailWithRoute();
});
void loadClientFeatures().then(async () => {
  if (COMMERCIAL_MODE_ENABLED && authSession?.accessToken) {
    await refreshBillingState({ silent: true });
  }
});
void loadItems().then(() => {
  restoreListScroll();
  syncDetailWithRoute();
});
setInterval(() => {
  void autoRefreshTick();
}, 15000);
