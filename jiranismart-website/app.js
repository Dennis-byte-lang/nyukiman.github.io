(() => {
  const SESSION_KEY = "jiranismart_session";
  const API_KEY = "jiranismart_api_base";

  const state = {
    session: null,
    diagnosticsOpen: false,
    pingOk: null,
    pingMessage: "Not checked",
    activeView: "overview",
    location: { lat: -1.286389, lng: 36.817223 },
    sellerLinkedBiker: null,
    buyerData: [],
    sellerProducts: [],
    sellerPendingOrders: [],
    bikerJobs: [],
    bikerStats: null,
    assistantRequests: [],
    agentStats: null,
    agentSellers: [],
    geoStatus: "Not requested",
    geoError: "",
  };

  const app = document.getElementById("app");

  const roleViews = {
    Buyer: [
      ["marketplace", "Marketplace"],
      ["sos", "Emergency SOS"],
    ],
    Seller: [
      ["overview", "Seller Dashboard"],
      ["products", "Manage Products"],
      ["linking", "Order-Biker Linking"],
      ["payments", "Payments"],
    ],
    Biker: [
      ["overview", "Biker Dashboard"],
      ["jobs", "Jobs Workflow"],
      ["subscription", "Subscription"],
    ],
    Bodaboda: [
      ["overview", "Biker Dashboard"],
      ["jobs", "Jobs Workflow"],
      ["subscription", "Subscription"],
    ],
    Mechanic: [
      ["overview", "Assistant Dashboard"],
      ["requests", "Rescue Requests"],
    ],
    "Road assistant": [
      ["overview", "Assistant Dashboard"],
      ["requests", "Rescue Requests"],
    ],
    Agent: [
      ["overview", "Agent Dashboard"],
      ["sellers", "Seller Registry"],
    ],
  };

  const normalizeBase = (raw) => {
    const val = (raw || "").trim().replace(/\/+$/, "");
    if (!val) {
      const host = window.location.hostname || "localhost";
      const protocol = window.location.protocol === "https:" ? "https:" : "http:";
      return `${protocol}//${host}:5000/api`;
    }
    return val.endsWith("/api") ? val : `${val}/api`;
  };

  const getApiBase = () => {
    const localOverride = localStorage.getItem(API_KEY);
    const configuredBase = window.JIRANI_CONFIG?.apiBaseUrl || "";
    return normalizeBase(localOverride || configuredBase);
  };

  const getInitialViewForRole = (role) => {
    if (role === "Buyer") return "marketplace";
    return "overview";
  };

  const roleSlug = (role) => String(role || "user").toLowerCase().replace(/\s+/g, "-");

  const saveSession = (data) => {
    state.session = data;
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  };

  const clearSession = () => {
    state.session = null;
    localStorage.removeItem(SESSION_KEY);
  };

  const setNotice = (target, message, kind = "") => {
    if (!target) return;
    let slot = target.querySelector(".form-status");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "form-status";
      target.prepend(slot);
    }
    slot.innerHTML = `<div class="notice ${kind}">${message}</div>`;
  };

  const clearNotice = (target) => {
    if (!target) return;
    const slot = target.querySelector(".form-status");
    if (slot) slot.innerHTML = "";
  };

  const normalizePhone = (value) => String(value || "").trim();
  const isValidPhone = (value) => /^(?:\+?254|0)\d{9}$/.test(normalizePhone(value));
  const normalizeRoleName = (value) => String(value || "").trim().toLowerCase();
  const escapeHtml = (value) =>
    String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const parseBody = async (res) => {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { message: text || "Unknown response" };
    }
  };

  const authHeaders = (json = true) => {
    const headers = {};
    if (json) headers["Content-Type"] = "application/json";
    if (state.session?.token) headers.Authorization = `Bearer ${state.session.token}`;
    return headers;
  };

  const api = async (path, options = {}) => {
    const url = `${getApiBase()}${path}`;
    const res = await fetch(url, options);
    const body = await parseBody(res);
    if (!res.ok) {
      throw new Error(body.message || body.error || `Request failed (${res.status})`);
    }
    return body;
  };

  const ensureGeo = async () => {
    if (!navigator.geolocation) {
      state.geoStatus = "Unsupported in this browser";
      state.geoError = "Geolocation API is not available.";
      return state.location;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          state.location = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          state.geoStatus = "Enabled";
          state.geoError = "";
          resolve(state.location);
        },
        (err) => {
          if (err?.code === 1) state.geoStatus = "Permission denied";
          else if (err?.code === 2) state.geoStatus = "Position unavailable";
          else if (err?.code === 3) state.geoStatus = "Location timeout";
          else state.geoStatus = "Location unavailable";

          state.geoError =
            err?.message ||
            "Allow location permission in your browser and use HTTPS (or localhost) for GPS.";
          resolve(state.location);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  };

  const buildOsmEmbedUrl = (lat, lng, span = 0.02) => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return "";

    const safeSpan = Math.max(0.005, Number(span) || 0.02);
    const left = lngNum - safeSpan;
    const right = lngNum + safeSpan;
    const top = latNum + safeSpan;
    const bottom = latNum - safeSpan;

    return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${latNum}%2C${lngNum}`;
  };

  const renderMapPanel = (targetEl, lat, lng, title = "Selected Location") => {
    if (!targetEl) return;

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      targetEl.innerHTML = `<div class="notice">Map coordinates not available.</div>`;
      return;
    }

    const src = buildOsmEmbedUrl(latNum, lngNum);
    const mapLink = `https://www.openstreetmap.org/?mlat=${latNum}&mlon=${lngNum}#map=15/${latNum}/${lngNum}`;

    targetEl.innerHTML = `
      <div class="map-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${latNum.toFixed(5)}, ${lngNum.toFixed(5)}</span>
      </div>
      <iframe
        class="map-frame"
        src="${src}"
        title="${escapeHtml(title)} map"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>
      <a class="btn secondary map-link-btn" href="${mapLink}" target="_blank" rel="noopener noreferrer">Open Full Map</a>
    `;
  };

  const renderAuth = () => {
    const tpl = document.getElementById("auth-template");
    app.innerHTML = "";
    app.appendChild(tpl.content.cloneNode(true));

    const tabs = app.querySelectorAll(".tab");
    const authModal = app.querySelector("#auth-modal");
    const authTrigger = app.querySelector("#auth-trigger");
    const authClose = app.querySelector("#auth-close");
    const forms = {
      login: app.querySelector("#login-form"),
      register: app.querySelector("#register-form"),
      reset: app.querySelector("#reset-form"),
    };
    const loginRoleSelect = app.querySelector("#login-role-select");
    const loginRoleTitle = app.querySelector("#login-role-title");
    const loginRoleSubtitle = app.querySelector("#login-role-subtitle");
    const loginRoleIcon = app.querySelector("#login-role-icon");
    const agentLoginBrief = app.querySelector("#agent-login-brief");
    const agentLoginMeta = app.querySelector("#agent-login-meta");
    const registerRoleSelect = app.querySelector("#register-role-select");
    const sellerCategoryWrap = app.querySelector("#seller-category-wrap");
    const roleDetailWrap = app.querySelector("#role-detail-wrap");
    const registerBusinessCategory = app.querySelector("#register-business-category");
    const registerExtraDetail = app.querySelector("#register-extra-detail");
    const registerDetailLabel = app.querySelector("#register-detail-label");
    const sendCodeBtn = app.querySelector("#send-code-btn");
    let resendSeconds = 0;
    let resendTimer = null;

    const updateSendCodeButton = () => {
      if (!sendCodeBtn) return;
      if (resendSeconds > 0) {
        sendCodeBtn.disabled = true;
        sendCodeBtn.textContent = `Resend in ${resendSeconds}s`;
      } else {
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = "Send Verification Code";
      }
    };

    const setSubmitBusy = (form, isBusy, busyLabel, idleLabel) => {
      const submitBtn = form?.querySelector('button[type="submit"]');
      if (!submitBtn) return;
      submitBtn.disabled = isBusy;
      submitBtn.textContent = isBusy ? busyLabel : idleLabel;
    };

    const openTab = (tabName) => {
      tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
      Object.entries(forms).forEach(([key, form]) => {
        form.classList.toggle("active", key === tabName);
      });
    };

    const applyLoginRolePresentation = () => {
      const role = String(loginRoleSelect?.value || "").trim();
      const loginSubmit = forms.login.querySelector('button[type="submit"]');
      if (!role) return;

      forms.login.classList.toggle("agent-mode", normalizeRoleName(role) === "agent");

      if (normalizeRoleName(role) === "agent") {
        if (loginRoleTitle) loginRoleTitle.textContent = "Agent Command Portal";
        if (loginRoleSubtitle) loginRoleSubtitle.textContent = "Secure sign-in for regional oversight, governance, and operational controls.";
        if (loginRoleIcon) loginRoleIcon.textContent = "🛡️";
        if (loginSubmit) loginSubmit.textContent = "Enter Agent Portal";
        agentLoginBrief?.classList.remove("hidden");
        agentLoginMeta?.classList.remove("hidden");
        return;
      }

      const roleIconMap = {
        buyer: "🛒",
        seller: "🏬",
        biker: "🏍️",
        bodaboda: "🏍️",
        mechanic: "🛠️",
        "road assistant": "🚧",
      };

      if (loginRoleTitle) loginRoleTitle.textContent = `${role} Login`;
      if (loginRoleSubtitle) loginRoleSubtitle.textContent = "Sign in to continue to your workspace.";
      if (loginRoleIcon) loginRoleIcon.textContent = roleIconMap[normalizeRoleName(role)] || "👤";
      if (loginSubmit) loginSubmit.textContent = "Login";
      agentLoginBrief?.classList.add("hidden");
      agentLoginMeta?.classList.add("hidden");
    };

    const applyRegisterRolePresentation = () => {
      const role = String(registerRoleSelect?.value || "").trim();
      const roleLower = normalizeRoleName(role);

      const isSeller = roleLower === "seller";
      const needsDetail = ["biker", "agent", "mechanic"].includes(roleLower);

      sellerCategoryWrap?.classList.toggle("hidden", !isSeller);
      roleDetailWrap?.classList.toggle("hidden", !needsDetail);

      if (registerBusinessCategory) {
        registerBusinessCategory.required = isSeller;
      }
      if (registerExtraDetail) {
        registerExtraDetail.required = needsDetail;
      }

      if (registerDetailLabel && registerExtraDetail) {
        if (roleLower === "biker") {
          registerDetailLabel.firstChild.textContent = "Vehicle Type";
          registerExtraDetail.placeholder = "Motorbike / Bicycle / Car";
        } else if (roleLower === "agent") {
          registerDetailLabel.firstChild.textContent = "Agent Detail";
          registerExtraDetail.placeholder = "Field Agent / Regional Agent";
        } else if (roleLower === "mechanic") {
          registerDetailLabel.firstChild.textContent = "Mechanic Specialty";
          registerExtraDetail.placeholder = "Roadside Repair / Tow Support";
        } else {
          registerDetailLabel.firstChild.textContent = "Vehicle / Operation Detail";
          registerExtraDetail.placeholder = "Motorbike / Field Agent / Mechanic";
        }
      }
    };

    const startResendCountdown = (seconds = 45) => {
      resendSeconds = seconds;
      updateSendCodeButton();
      if (resendTimer) clearInterval(resendTimer);
      resendTimer = setInterval(() => {
        resendSeconds -= 1;
        if (resendSeconds <= 0) {
          resendSeconds = 0;
          clearInterval(resendTimer);
          resendTimer = null;
        }
        updateSendCodeButton();
      }, 1000);
    };

    const openAuthModal = () => authModal?.classList.remove("hidden");
    const closeAuthModal = () => authModal?.classList.add("hidden");

    authTrigger?.addEventListener("click", openAuthModal);
    authClose?.addEventListener("click", closeAuthModal);
    authModal?.addEventListener("click", (e) => {
      if (e.target === authModal) closeAuthModal();
    });

    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        openTab(btn.dataset.tab);
      });
    });

    loginRoleSelect?.addEventListener("change", applyLoginRolePresentation);
    applyLoginRolePresentation();
    registerRoleSelect?.addEventListener("change", applyRegisterRolePresentation);
    applyRegisterRolePresentation();

    forms.login.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearNotice(forms.login);
      const fd = new FormData(forms.login);
      const selectedRole = String(fd.get("selectedRole") || "").trim();
      const payload = {
        phone: normalizePhone(fd.get("phone")),
        password: String(fd.get("password") || ""),
        role: selectedRole,
      };
      if (!isValidPhone(payload.phone)) {
        setNotice(forms.login, "Enter a valid phone number (07... or +254...).", "error");
        return;
      }
      if (!selectedRole) {
        setNotice(forms.login, "Please select your role to continue.", "error");
        return;
      }
      if (payload.password.length < 6) {
        setNotice(forms.login, "Password must be at least 6 characters.", "error");
        return;
      }

      setSubmitBusy(forms.login, true, "Signing In...", "Login");
      try {
        const data = await api("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const accountRole = data?.user?.role || "";
        if (normalizeRoleName(accountRole) !== normalizeRoleName(selectedRole)) {
          setNotice(
            forms.login,
            `This account is registered as "${accountRole}". Select that role to login.`,
            "error"
          );
          return;
        }

        saveSession({ token: data.token, user: data.user, stats: data.stats || {} });
        state.activeView = getInitialViewForRole(data.user?.role);
        await renderDashboard();
      } catch (err) {
        setNotice(forms.login, err.message, "error");
      } finally {
        setSubmitBusy(forms.login, false, "Signing In...", "Login");
      }
    });

    forms.register.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearNotice(forms.register);
      const fd = new FormData(forms.register);
      const password = String(fd.get("password") || "");
      const confirmPassword = String(fd.get("confirmPassword") || "");
      const phone = normalizePhone(fd.get("phone"));

      if (!isValidPhone(phone)) {
        setNotice(forms.register, "Enter a valid phone number (07... or +254...).", "error");
        return;
      }
      if (password.length < 6) {
        setNotice(forms.register, "Password must be at least 6 characters.", "error");
        return;
      }

      if (password !== confirmPassword) {
        setNotice(forms.register, "Passwords do not match.", "error");
        return;
      }

      const payload = {
        name: String(fd.get("name") || "").trim(),
        phone,
        password,
        role: String(fd.get("role") || "Buyer"),
        extraDetail: (() => {
          const role = normalizeRoleName(String(fd.get("role") || "Buyer"));
          if (role === "seller") {
            return String(fd.get("businessCategory") || "General").trim();
          }
          if (["biker", "agent", "mechanic"].includes(role)) {
            return String(fd.get("extraDetail") || "").trim();
          }
          return "";
        })(),
      };

      setSubmitBusy(forms.register, true, "Creating Account...", "Register");
      try {
        await api("/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setNotice(forms.register, "Registration successful. Please login to continue.", "ok");
        forms.login.querySelector('input[name="phone"]').value = phone;
        forms.login.querySelector('input[name="password"]').focus();
        openTab("login");
        openAuthModal();
      } catch (err) {
        setNotice(forms.register, err.message, "error");
      } finally {
        setSubmitBusy(forms.register, false, "Creating Account...", "Register");
      }
    });

    sendCodeBtn.addEventListener("click", async () => {
      clearNotice(forms.reset);
      const fd = new FormData(forms.reset);
      const phone = normalizePhone(fd.get("phone"));
      if (!phone) {
        setNotice(forms.reset, "Enter phone first.", "error");
        return;
      }
      if (!isValidPhone(phone)) {
        setNotice(forms.reset, "Enter a valid phone number (07... or +254...).", "error");
        return;
      }
      try {
        sendCodeBtn.disabled = true;
        sendCodeBtn.textContent = "Sending...";
        await api("/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        setNotice(forms.reset, "Verification code sent. Check your phone and continue to Step 2.", "ok");
        startResendCountdown();
      } catch (err) {
        setNotice(forms.reset, err.message, "error");
        resendSeconds = 0;
        updateSendCodeButton();
      }
    });

    forms.reset.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearNotice(forms.reset);
      const fd = new FormData(forms.reset);
      const phone = normalizePhone(fd.get("phone"));
      const code = String(fd.get("code") || "").trim();
      const newPassword = String(fd.get("newPassword") || "");
      const confirmNewPassword = String(fd.get("confirmNewPassword") || "");

      if (!phone || !code || !newPassword || !confirmNewPassword) {
        setNotice(forms.reset, "Please complete all reset fields.", "error");
        return;
      }
      if (!isValidPhone(phone)) {
        setNotice(forms.reset, "Enter a valid phone number (07... or +254...).", "error");
        return;
      }
      if (newPassword.length < 6) {
        setNotice(forms.reset, "New password must be at least 6 characters.", "error");
        return;
      }
      if (newPassword !== confirmNewPassword) {
        setNotice(forms.reset, "Passwords do not match.", "error");
        return;
      }

      const submitBtn = forms.reset.querySelector('button[type="submit"]');
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Updating...";
        }
        await api("/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone,
            code,
            newPassword,
          }),
        });
        forms.reset.reset();
        resendSeconds = 0;
        updateSendCodeButton();
        setNotice(forms.reset, "Password updated successfully. You can now login.", "ok");
      } catch (err) {
        setNotice(forms.reset, err.message, "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Reset Password";
        }
      }
    });
  };

  const renderMenu = () => {
    const role = state.session.user.role;
    const items = roleViews[role] || [["overview", `${role} Dashboard`]];
    const menu = app.querySelector("#dashboard-menu");
    menu.innerHTML = items
      .map(
        ([id, label]) =>
          `<button data-view="${id}" class="${state.activeView === id ? "active" : ""}">${label}</button>`
      )
      .join("");

    menu.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.activeView = btn.dataset.view;
        await renderDashboard();
      });
    });
  };

  const renderDiagnostics = () => {
    const pane = app.querySelector("#diagnostics");
    if (!pane) return;

    const dotClass = state.pingOk ? "status-ok" : "status-bad";
    const text = state.pingOk === null ? "Not checked" : state.pingOk ? "Reachable" : "Offline";

    pane.classList.toggle("hidden", !state.diagnosticsOpen);
    pane.innerHTML = `
      <div><strong>Backend URL:</strong> ${getApiBase()}</div>
      <div><span class="status-dot ${dotClass}"></span> <strong>Ping:</strong> ${text}</div>
      <div><strong>Message:</strong> ${state.pingMessage}</div>
      <div><strong>GPS:</strong> ${state.geoStatus}</div>
      <div><strong>Location:</strong> ${state.location.lat.toFixed(6)}, ${state.location.lng.toFixed(6)}</div>
      ${state.geoError ? `<div class="notice error">${state.geoError}</div>` : ""}
      <div class="row">
        <input id="api-base-input" value="${getApiBase()}" />
        <button id="save-api-btn" class="btn secondary" type="button">Save URL</button>
        <button id="ping-btn" class="btn primary" type="button">Ping</button>
        <button id="gps-btn" class="btn secondary" type="button">Enable GPS</button>
      </div>
    `;

    pane.querySelector("#save-api-btn").addEventListener("click", () => {
      const input = pane.querySelector("#api-base-input").value;
      localStorage.setItem(API_KEY, normalizeBase(input));
      state.pingMessage = "URL saved";
      renderDiagnostics();
    });

    pane.querySelector("#ping-btn").addEventListener("click", pingBackend);
    pane.querySelector("#gps-btn").addEventListener("click", async () => {
      await ensureGeo();
      renderDiagnostics();
    });
  };

  const pingBackend = async () => {
    try {
      const data = await api("/health/db", { method: "GET" });
      state.pingOk = true;
      const dbName = data.database || "unknown_db";
      state.pingMessage = `${data.message || "Backend online"} (${dbName})`;
    } catch (err) {
      state.pingOk = false;
      state.pingMessage = err.message;
    }
    renderDiagnostics();
  };

  const renderDashboard = async () => {
    const tpl = document.getElementById("dashboard-template");
    app.innerHTML = "";
    app.appendChild(tpl.content.cloneNode(true));

    const role = state.session.user.role;
    const name = state.session.user.name || "User";
    const shell = app.querySelector(".shell");
    shell?.classList.add(`role-${roleSlug(role)}`);

    app.querySelector("#session-role").textContent = `${role} Session`;
    app.querySelector("#dashboard-title").textContent = `${role} Console`;
    app.querySelector("#welcome-line").textContent = `Welcome ${name}. All role tools are active.`;

    app.querySelector("#logout-btn").addEventListener("click", () => {
      clearSession();
      renderAuth();
    });

    app.querySelector("#diag-toggle").addEventListener("click", () => {
      state.diagnosticsOpen = !state.diagnosticsOpen;
      renderDiagnostics();
    });

    renderMenu();
    renderDiagnostics();
    await renderRoleContent();
  };

  const setContent = (html) => {
    app.querySelector("#dashboard-content").innerHTML = html;
  };

  const renderRoleContent = async () => {
    const role = state.session.user.role;
    if (role === "Buyer") return renderBuyer();
    if (role === "Seller") return renderSeller();
    if (role === "Biker" || role === "Bodaboda") return renderBiker();
    if (role === "Mechanic" || role === "Road assistant") return renderAssistant();
    if (role === "Agent") return renderAgent();

    setContent(`<div class="panel card">Unsupported role: ${role}</div>`);
  };

  const renderBuyer = async () => {
    const view = state.activeView;
    if (view === "sos") return renderBuyerSos();
    if (view !== "marketplace") state.activeView = "marketplace";

    await ensureGeo();
    const sellers = await api(
      `/auth/nearby?lat=${state.location.lat}&lng=${state.location.lng}&radius=10`,
      { headers: authHeaders(false) }
    ).catch(() => ({ sellers: [] }));

    state.buyerData = sellers.sellers || [];
    const baseCategories = [
      "All",
      "Grocery",
      "Pharmacy",
      "Restaurant",
      "Fast Food",
      "Bakery",
      "Butchery",
      "Electronics",
      "Fashion",
      "Hardware",
      "Water",
      "Gas",
      "Stationery",
      "Salon",
      "Agrovet",
      "BodaBoda",
      "Mechanic",
      "General",
    ];
    const liveCategories = state.buyerData
      .map((s) => String(s.category || "General").trim())
      .filter(Boolean);
    const categoryMap = new Map();
    [...baseCategories, ...liveCategories].forEach((cat) => {
      const key = cat.toLowerCase();
      if (!categoryMap.has(key)) categoryMap.set(key, cat);
    });
    const categories = Array.from(categoryMap.values());

    setContent(`
      <section class="panel card panel-compact">
        <h3>Nearby Categories</h3>
        <div id="cat-row" class="buyer-categories"></div>
        <div class="row">
          <button id="geo-enable" class="btn primary">Enable GPS</button>
          <button id="geo-refresh" class="btn secondary">Refresh Location</button>
          <button id="buyer-refresh" class="btn secondary">Refresh Sellers</button>
        </div>
      </section>
      <section class="panel card panel-wide">
        <h3>Product Search</h3>
        <p>Search products by name. Category follows your current selection.</p>
        <form id="buyer-product-search" class="row product-search-simple">
          <input id="buyer-product-query" name="query" placeholder="Search product e.g. milk, bread, charger" />
          <button type="submit" class="btn primary">Search</button>
        </form>
        <div id="buyer-product-list" class="list"></div>
      </section>
      <section class="panel card panel-wide">
        <h3>Nearby Businesses</h3>
        <div id="buyer-map" class="map-panel"></div>
        <div id="buyer-list" class="list"></div>
      </section>
    `);

    const catRow = app.querySelector("#cat-row");
    const list = app.querySelector("#buyer-list");
    const buyerMap = app.querySelector("#buyer-map");
    const productList = app.querySelector("#buyer-product-list");
    const productForm = app.querySelector("#buyer-product-search");
    const productInput = app.querySelector("#buyer-product-query");
    let active = "All";

    const renderProductResults = (products, searched) => {
      if (!searched) {
        productList.innerHTML = "";
        return;
      }
      productList.innerHTML =
        products
          .map(
            (p) => `
          <div class="list-item">
            <div class="list-main">
              <h4>${p.name || "Product"}</h4>
              <p>${p.category || "General"} • ${p.shop_name || "Local Seller"} • Stock ${p.stock_quantity ?? 0}</p>
            </div>
            <div class="product-price">KSh ${Number(p.price || 0).toFixed(0)}</div>
          </div>
        `
          )
          .join("") || `<div class="list-item"><p>No products found for this search.</p></div>`;
    };

    const runProductSearch = async () => {
      const q = String(productInput.value || "").trim();
      if (!q) {
        renderProductResults([], false);
        return;
      }
      const params = new URLSearchParams();
      params.set("q", q);
      if (active !== "All") params.set("category", active);
      productList.innerHTML = `<div class="list-item"><p>Searching products...</p></div>`;
      try {
        const result = await api(`/products/search?${params.toString()}`, { headers: authHeaders(false) });
        renderProductResults(result.products || [], true);
      } catch (err) {
        productList.innerHTML = `<div class="list-item"><p>${err.message}</p></div>`;
      }
    };

    const draw = () => {
      catRow.innerHTML = categories
        .map((c) => `<button class="btn ${c === active ? "primary" : "secondary"}" data-cat="${c}">${c}</button>`)
        .join("");

      const filtered = state.buyerData.filter((s) => active === "All" || (s.category || "General") === active);
      list.innerHTML =
        filtered
          .map(
            (s) => `
          <div class="list-item">
            <div class="list-main">
              <h4>${s.shop_name || "Shop"}</h4>
              <p>${s.category || "General"} • ${(Number(s.distance) || 0).toFixed(1)} km away</p>
            </div>
            <div class="row">
              <button
                class="btn secondary view-map"
                data-lat="${s.lat}"
                data-lng="${s.lng}"
                data-label="${escapeHtml(s.shop_name || "Shop")}"
              >
                View Map
              </button>
              <button class="btn secondary nearest-biker" data-lat="${s.lat}" data-lng="${s.lng}">Nearest Biker</button>
            </div>
          </div>
        `
          )
          .join("") || `<div class="list-item"><p>No nearby businesses found.</p></div>`;

      catRow.querySelectorAll("button").forEach((btn) => {
        btn.onclick = () => {
          active = btn.dataset.cat;
          draw();
          if (String(productInput.value || "").trim()) runProductSearch();
        };
      });

      list.querySelectorAll(".view-map").forEach((btn) => {
        btn.onclick = () => {
          renderMapPanel(buyerMap, btn.dataset.lat, btn.dataset.lng, btn.dataset.label || "Business Location");
        };
      });

      list.querySelectorAll(".nearest-biker").forEach((btn) => {
        btn.onclick = async () => {
          try {
            const biker = await api(`/auth/nearest-biker?lat=${btn.dataset.lat}&lng=${btn.dataset.lng}`, {
              headers: authHeaders(false),
            });
            alert(`Nearest biker: ${biker.name || "Biker"} (${biker.phone || "N/A"})`);
          } catch (err) {
            alert(err.message);
          }
        };
      });
    };

    draw();
    renderMapPanel(buyerMap, state.location.lat, state.location.lng, "Your Location");
    renderProductResults([], false);

    productForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await runProductSearch();
    });

    app.querySelector("#geo-refresh").onclick = async () => {
      await ensureGeo();
      await renderBuyer();
    };
    app.querySelector("#geo-enable").onclick = async () => {
      await ensureGeo();
      await renderBuyer();
    };
    app.querySelector("#buyer-refresh").onclick = renderBuyer;
  };

  const renderBuyerSos = async () => {
    setContent(`
      <section class="panel card panel-wide">
        <h3>Emergency SOS</h3>
        <p>Broadcast emergency requests to nearby assistants/mechanics.</p>
        <form id="sos-form" class="grid">
          <label>Issue <input name="issue" required placeholder="Flat tire / battery / breakdown" /></label>
          <label>Region <input name="region" placeholder="nairobi" value="nairobi" /></label>
          <label>Phone <input name="phone" placeholder="07xxxxxxxx" /></label>
          <label>Vehicle Details <input name="vehicleDetails" placeholder="Toyota Axio / motorbike / etc" /></label>
          <button class="btn primary" type="submit">Send SOS</button>
        </form>
      </section>
    `);

    app.querySelector("#sos-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await ensureGeo();
      const fd = new FormData(e.target);
      try {
        const data = await api("/assistant/sos/request", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            issue: String(fd.get("issue") || "").trim(),
            region: String(fd.get("region") || "nairobi").trim(),
            phone: String(fd.get("phone") || "").trim(),
            vehicleDetails: String(fd.get("vehicleDetails") || "").trim(),
            lat: state.location.lat,
            lng: state.location.lng,
          }),
        });
        alert(data.message || "SOS sent");
      } catch (err) {
        alert(err.message);
      }
    });
  };

  const renderSeller = async () => {
    const userId = state.session.user.id;
    if (state.activeView === "products") return renderSellerProducts(userId);
    if (state.activeView === "linking") return renderSellerLinking(userId);
    if (state.activeView === "payments") return renderSellerPayments(userId);

    const analytics = await api(`/sellers/analytics/${userId}`, {
      headers: authHeaders(false),
    }).catch(() => ({ data: {} }));

    const data = analytics.data || {};

    setContent(`
      <section class="panel card panel-wide panel-analytics">
        <h3>Seller Metrics</h3>
        <div class="grid cols-3">
          <article class="metric"><h4>Total Orders</h4><p>${data.total_orders || 0}</p></article>
          <article class="metric"><h4>Revenue</h4><p>KSh ${data.total_revenue || 0}</p></article>
          <article class="metric"><h4>Low Stock</h4><p>${data.low_stock_count || 0}</p></article>
        </div>
      </section>
      <section class="panel card panel-compact panel-actions">
        <h3>Quick Actions</h3>
        <div class="row">
          <button id="open-products" class="btn secondary">Manage Products</button>
          <button id="open-linking" class="btn secondary">Link Order to Biker</button>
        </div>
      </section>
    `);

    app.querySelector("#open-products").onclick = async () => {
      state.activeView = "products";
      await renderDashboard();
    };
    app.querySelector("#open-linking").onclick = async () => {
      state.activeView = "linking";
      await renderDashboard();
    };
  };

  const renderSellerProducts = async (userId) => {
    const productsRes = await api(`/products/seller/${userId}`, {
      headers: authHeaders(false),
    }).catch(() => ({ products: [] }));

    state.sellerProducts = productsRes.products || [];

    setContent(`
      <section class="panel card panel-wide panel-actions">
        <h3>Add Product</h3>
        <form id="add-product-form" class="grid cols-2">
          <label>Name <input name="name" required /></label>
          <label>Category <input name="category" value="General" /></label>
          <label>Price <input name="price" required type="number" min="1" /></label>
          <label>Stock Quantity <input name="stockQuantity" required type="number" min="0" /></label>
          <label style="grid-column:1/-1;">Description <textarea name="description"></textarea></label>
          <button class="btn primary" type="submit">Add Product</button>
        </form>
      </section>
      <section class="panel card panel-wide">
        <h3>Your Products</h3>
        <div id="product-list" class="list"></div>
      </section>
    `);

    const list = app.querySelector("#product-list");
    list.innerHTML =
      state.sellerProducts
        .map(
          (p) => `
      <div class="list-item">
        <div class="list-main">
          <h4>${p.name}</h4>
          <p>KSh ${p.price} • Stock ${p.stock_quantity} • ${p.category || "General"}</p>
        </div>
        <div class="row">
          <button class="btn secondary edit-product" data-id="${p.id}">Update Stock</button>
          <button class="btn danger delete-product" data-id="${p.id}">Delete</button>
        </div>
      </div>
    `
        )
        .join("") || `<div class="list-item"><p>No products available.</p></div>`;

    app.querySelector("#add-product-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      fd.append("sellerId", String(userId));

      try {
        const res = await fetch(`${getApiBase()}/products/add`, {
          method: "POST",
          headers: { Authorization: `Bearer ${state.session.token}` },
          body: fd,
        });
        const body = await parseBody(res);
        if (!res.ok) throw new Error(body.message || "Failed");
        await renderSellerProducts(userId);
      } catch (err) {
        alert(err.message);
      }
    });

    list.querySelectorAll(".delete-product").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(`/products/delete/${btn.dataset.id}`, {
            method: "DELETE",
            headers: authHeaders(false),
          });
          await renderSellerProducts(userId);
        } catch (err) {
          alert(err.message);
        }
      };
    });

    list.querySelectorAll(".edit-product").forEach((btn) => {
      btn.onclick = async () => {
        const qty = prompt("New stock quantity:");
        if (qty === null) return;
        const target = state.sellerProducts.find((p) => String(p.id) === btn.dataset.id);
        if (!target) return;

        const fd = new FormData();
        fd.append("name", target.name);
        fd.append("description", target.description || "");
        fd.append("price", target.price);
        fd.append("stockQuantity", qty);
        fd.append("category", target.category || "General");

        try {
          const res = await fetch(`${getApiBase()}/products/update/${btn.dataset.id}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${state.session.token}` },
            body: fd,
          });
          const body = await parseBody(res);
          if (!res.ok) throw new Error(body.message || "Update failed");
          await renderSellerProducts(userId);
        } catch (err) {
          alert(err.message);
        }
      };
    });
  };

  const renderSellerLinking = async (userId) => {
    await ensureGeo();

    const biker = await api(`/auth/nearest-biker?lat=${state.location.lat}&lng=${state.location.lng}`, {
      headers: authHeaders(false),
    }).catch(() => null);
    state.sellerLinkedBiker = biker;

    const ordersRes = await api(`/sellers/pending-orders/${userId}`, {
      headers: authHeaders(false),
    }).catch(() => ({ orders: [] }));
    state.sellerPendingOrders = ordersRes.orders || [];

    setContent(`
      <section class="panel card panel-compact">
        <h3>Nearest Biker</h3>
        ${
          state.sellerLinkedBiker
            ? `<div class="notice ok">${state.sellerLinkedBiker.name || "Biker"} • ${
                state.sellerLinkedBiker.phone || "No phone"
              } • ${(Number(state.sellerLinkedBiker.distance) || 0).toFixed(1)} km</div>`
            : `<div class="notice error">No biker available right now.</div>`
        }
      </section>
      <section class="panel card panel-wide">
        <h3>Pending Orders</h3>
        <div id="pending-list" class="list"></div>
      </section>
    `);

    const list = app.querySelector("#pending-list");
    list.innerHTML =
      state.sellerPendingOrders
        .map(
          (o) => `
      <div class="list-item">
        <div class="list-main">
          <h4>Order #${o.id}</h4>
          <p>KSh ${o.amount || 0} • Buyer ${o.buyer_id || "N/A"} • ${o.status}</p>
        </div>
        <button class="btn primary link-order" data-id="${o.id}" ${!state.sellerLinkedBiker ? "disabled" : ""}>Link</button>
      </div>
    `
        )
        .join("") || `<div class="list-item"><p>No pending orders.</p></div>`;

    list.querySelectorAll(".link-order").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(`/sellers/link-order/${userId}`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              orderId: btn.dataset.id,
              bikerId: state.sellerLinkedBiker.id,
            }),
          });
          alert(`Order #${btn.dataset.id} linked successfully.`);
          await renderSellerLinking(userId);
        } catch (err) {
          alert(err.message);
        }
      };
    });
  };

  const renderSellerPayments = async (userId) => {
    const history = await api(`/sellers/payment-history/${userId}`, {
      headers: authHeaders(false),
    }).catch(() => ({ history: [] }));

    setContent(`
      <section class="panel card panel-wide">
        <h3>Payment History</h3>
        <div class="list">
          ${
            (history.history || [])
              .map(
                (h) => `
            <div class="list-item">
              <div class="list-main">
                <h4>KSh ${h.amount || 0}</h4>
                <p>${h.receipt || "N/A"} • ${h.status || "pending"}</p>
              </div>
              <span class="badge ${h.status === "completed" ? "ok" : "pending"}">${h.status || "pending"}</span>
            </div>
          `
              )
              .join("") || `<div class="list-item"><p>No payments found.</p></div>`
          }
        </div>
      </section>
    `);
  };

  const renderBiker = async () => {
    const view = state.activeView;
    if (view === "jobs") return renderBikerJobs();
    if (view === "subscription") return renderBikerSubscription();

    const stats = await api("/orders/stats", { headers: authHeaders(false) }).catch(() => ({ stats: {} }));
    state.bikerStats = stats.stats || {};

    setContent(`
      <section class="panel card panel-wide panel-analytics">
        <h3>Biker Metrics</h3>
        <div class="grid cols-3">
          <article class="metric"><h4>Active Jobs</h4><p>${state.bikerStats.activeJobs || 0}</p></article>
          <article class="metric"><h4>Completed</h4><p>${state.bikerStats.completedJobs || 0}</p></article>
          <article class="metric"><h4>Earnings</h4><p>KSh ${Number(state.bikerStats.earnings || 0).toFixed(0)}</p></article>
        </div>
        <div class="row" style="margin-top:10px;">
          <button id="go-jobs" class="btn secondary">Open Jobs</button>
          <button id="go-sub" class="btn secondary">Subscription</button>
        </div>
      </section>
    `);

    app.querySelector("#go-jobs").onclick = async () => {
      state.activeView = "jobs";
      await renderDashboard();
    };
    app.querySelector("#go-sub").onclick = async () => {
      state.activeView = "subscription";
      await renderDashboard();
    };
  };

  const renderBikerJobs = async () => {
    const jobs = await api("/orders/available", { headers: authHeaders(false) }).catch(() => ({ orders: [] }));
    state.bikerJobs = jobs.orders || [];

    setContent(`
      <section class="panel card panel-wide">
        <h3>Available Jobs</h3>
        <div id="jobs-list" class="list"></div>
      </section>
    `);

    const list = app.querySelector("#jobs-list");
    list.innerHTML =
      state.bikerJobs
        .map(
          (j) => `
      <div class="list-item">
        <div class="list-main">
          <h4>${j.business_name || "Merchant"} • Order #${j.id}</h4>
          <p>Amount: KSh ${j.amount || 0}</p>
        </div>
        <div class="row">
          <button class="btn primary accept-job" data-id="${j.id}">Accept</button>
          <button class="btn secondary pickup-job" data-id="${j.id}">Pickup</button>
          <button class="btn secondary complete-job" data-id="${j.id}">Complete</button>
        </div>
      </div>
    `
        )
        .join("") || `<div class="list-item"><p>No available jobs.</p></div>`;

    list.querySelectorAll(".accept-job").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api("/orders/accept", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ orderId: btn.dataset.id }),
          });
          await renderBikerJobs();
        } catch (err) {
          alert(err.message);
        }
      };
    });

    list.querySelectorAll(".pickup-job").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api("/orders/pickup", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ orderId: btn.dataset.id }),
          });
          alert(`Order #${btn.dataset.id} marked on_the_way.`);
        } catch (err) {
          alert(err.message);
        }
      };
    });

    list.querySelectorAll(".complete-job").forEach((btn) => {
      btn.onclick = async () => {
        await ensureGeo();
        try {
          await api("/orders/complete", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              orderId: btn.dataset.id,
              bikerLat: state.location.lat,
              bikerLng: state.location.lng,
            }),
          });
          alert(`Order #${btn.dataset.id} completed.`);
          await renderBikerJobs();
        } catch (err) {
          alert(err.message);
        }
      };
    });
  };

  const renderBikerSubscription = async () => {
    setContent(`
      <section class="panel card panel-compact panel-actions">
        <h3>Subscription Payment</h3>
        <p>Renew biker access with STK Push.</p>
        <form id="sub-form" class="grid cols-2">
          <label>Phone <input name="phone" required placeholder="07xxxxxxxx" /></label>
          <label>Amount <input name="amount" type="number" value="500" required /></label>
          <button class="btn primary" type="submit">Send STK Push</button>
        </form>
      </section>
    `);

    app.querySelector("#sub-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await api("/payments/stkpush", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            phone: String(fd.get("phone") || "").trim(),
            amount: Number(fd.get("amount") || 500),
            userId: state.session.user.id,
            type: "subscription",
          }),
        });
        alert(`STK push sent. Checkout ID: ${res.checkoutID || "N/A"}`);
      } catch (err) {
        alert(err.message);
      }
    });
  };

  const renderAssistant = async () => {
    if (state.activeView === "requests") return renderAssistantRequests();

    setContent(`
      <section class="panel card panel-compact panel-actions">
        <h3>Assistant Controls</h3>
        <div class="row">
          <button id="assistant-load" class="btn primary">Load Nearby SOS</button>
          <button id="assistant-view" class="btn secondary">Open Request Board</button>
        </div>
      </section>
    `);

    app.querySelector("#assistant-load").onclick = renderAssistantRequests;
    app.querySelector("#assistant-view").onclick = async () => {
      state.activeView = "requests";
      await renderDashboard();
    };
  };

  const renderAssistantRequests = async () => {
    await ensureGeo();
    const data = await api(
      `/assistant/nearby-sos?lat=${state.location.lat}&lng=${state.location.lng}&radius=25`,
      {
        headers: authHeaders(false),
      }
    ).catch(() => ({ requests: [] }));

    state.assistantRequests = data.requests || [];

    setContent(`
      <section class="panel card panel-wide">
        <h3>Nearby SOS Requests</h3>
        <div id="assist-list" class="list"></div>
      </section>
    `);

    const list = app.querySelector("#assist-list");
    list.innerHTML =
      state.assistantRequests
        .map(
          (r) => `
      <div class="list-item">
        <div class="list-main">
          <h4>Request #${r.id} • ${r.issue_description || "Emergency"}</h4>
          <p>${(Number(r.distance_km) || 0).toFixed(1)} km • ${r.client_phone || "No phone"}</p>
        </div>
        <div class="row">
          <button class="btn primary accept-sos" data-id="${r.id}">Accept</button>
          <button class="btn secondary complete-sos" data-id="${r.id}">Complete</button>
        </div>
      </div>
    `
        )
        .join("") || `<div class="list-item"><p>No SOS requests nearby.</p></div>`;

    list.querySelectorAll(".accept-sos").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api("/assistant/accept", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ requestId: btn.dataset.id }),
          });
          await renderAssistantRequests();
        } catch (err) {
          alert(err.message);
        }
      };
    });

    list.querySelectorAll(".complete-sos").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api("/assistant/complete", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ requestId: btn.dataset.id, totalFee: 0, notes: "Completed via web" }),
          });
          await renderAssistantRequests();
        } catch (err) {
          alert(err.message);
        }
      };
    });
  };

  const renderAgent = async () => {
    if (state.activeView === "sellers") return renderAgentSellers();

    const stats = await api(`/agent/dashboard-stats/${state.session.user.id}`, {
      headers: authHeaders(false),
    }).catch(() => ({ stats: {}, user: {} }));
    state.agentStats = stats.stats || {};

    setContent(`
      <section class="panel card panel-wide panel-analytics">
        <h3>Regional Overview</h3>
        <div class="grid cols-3">
          <article class="metric"><h4>Active Shops</h4><p>${state.agentStats.totalSellers || 0}</p></article>
          <article class="metric"><h4>Active Riders</h4><p>${state.agentStats.activeRiders || 0}</p></article>
          <article class="metric"><h4>Active SOS</h4><p>${state.agentStats.activeSOS || 0}</p></article>
        </div>
        <div class="grid cols-3" style="margin-top:10px;">
          <article class="metric"><h4>Critical Stock</h4><p>${state.agentStats.criticalStockCount || 0}</p></article>
          <article class="metric"><h4>System Volume</h4><p>KSh ${state.agentStats.systemVolume || 0}</p></article>
          <article class="metric"><h4>Commission</h4><p>KSh ${state.agentStats.commissionBalance || 0}</p></article>
        </div>
        <div class="row" style="margin-top:10px;">
          <button id="open-registry" class="btn secondary">Open Seller Registry</button>
        </div>
      </section>
    `);

    app.querySelector("#open-registry").onclick = async () => {
      state.activeView = "sellers";
      await renderDashboard();
    };
  };

  const renderAgentSellers = async () => {
    const sellers = await api("/agent/sellers", { headers: authHeaders(false) }).catch(() => ({ sellers: [] }));
    state.agentSellers = sellers.sellers || [];

    setContent(`
      <section class="panel card panel-wide">
        <h3>Seller Registry</h3>
        <div id="agent-sellers" class="list"></div>
      </section>
    `);

    const list = app.querySelector("#agent-sellers");
    list.innerHTML =
      state.agentSellers
        .map(
          (s) => `
      <div class="list-item">
        <div class="list-main">
          <h4>${s.shop_name || "Unnamed Shop"}</h4>
          <p>${s.phone || "N/A"} • Products ${s.product_count || 0} • Low stock ${s.low_stock_alerts || 0}</p>
        </div>
        <button class="btn danger deactivate-user" data-id="${s.id}">Deactivate</button>
      </div>
    `
        )
        .join("") || `<div class="list-item"><p>No sellers found.</p></div>`;

    list.querySelectorAll(".deactivate-user").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Deactivate this account?")) return;
        try {
          await api(`/agent/deactivate-user/${btn.dataset.id}`, {
            method: "PATCH",
            headers: authHeaders(false),
          });
          await renderAgentSellers();
        } catch (err) {
          alert(err.message);
        }
      };
    });
  };

  const bootstrap = async () => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        state.session = JSON.parse(raw);
      } catch {
        clearSession();
      }
    }

    if (!state.session?.token || !state.session?.user) {
      renderAuth();
      return;
    }

    if (!state.activeView || state.activeView === "overview") {
      state.activeView = getInitialViewForRole(state.session.user.role);
    }

    await renderDashboard();
    await pingBackend();
  };

  bootstrap();
})();
