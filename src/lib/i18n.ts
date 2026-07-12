import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const en = {
  app: {
    title: "Precision Engine Suite",
    tagline: "Verifiable scientific compute, real-time, in your browser.",
  },
  nav: {
    dashboard: "Dashboard",
    engines: "Engines",
    history: "Run History",
    alerts: "Alerts",
    docs: "Documentation",
  },
  common: {
    run: "Run",
    running: "Running…",
    input: "Input",
    output: "Result",
    export: "Export",
    exportPdf: "Export PDF",
    exportCsv: "Export CSV",
    verify: "Verify",
    verified: "Verified",
    documentation: "Documentation",
    equations: "Equations",
    parameters: "Parameters",
    duration: "Duration",
    memory: "Memory",
    status: "Status",
    open: "Open",
    clear: "Clear",
    search: "Search",
    language: "Language",
    workers: "Worker pool",
    parallelism: "Parallelism",
    accuracy: "Accuracy",
    checksum: "Checksum",
    rows: "rows",
  },
  engines: {
    integration: {
      name: "Numerical Integration",
      desc: "Composite Simpson & trapezoidal quadrature with Richardson extrapolation.",
    },
    regression: {
      name: "Linear Regression (OLS)",
      desc: "Ordinary least squares with R², SE, and residual analysis.",
    },
    statistics: {
      name: "Descriptive Statistics",
      desc: "Mean, variance (Welford), quantiles, skewness, kurtosis.",
    },
    fft: {
      name: "Fast Fourier Transform",
      desc: "Radix-2 Cooley–Tukey FFT with magnitude & phase spectra.",
    },
    ode: {
      name: "ODE Solver (RK4)",
      desc: "Fourth-order Runge–Kutta with adaptive step reporting.",
    },
  },
  hero: {
    kpiRuns: "Total runs",
    kpiEngines: "Engines available",
    kpiWorkers: "Active workers",
    kpiAlerts: "Open alerts",
  },
  history: {
    empty: "No runs recorded yet. Execute an engine to populate history.",
    columns: {
      time: "Time",
      engine: "Engine",
      duration: "ms",
      status: "Status",
      checksum: "Checksum",
    },
  },
  alerts: {
    empty: "No alerts.",
    threshold: "Threshold exceeded",
    completed: "Run completed",
    failed: "Run failed",
  },
};

const ar: typeof en = {
  app: {
    title: "منظومة المحركات الدقيقة",
    tagline: "حساب علمي قابل للتحقق، آنيّ، داخل متصفحك.",
  },
  nav: {
    dashboard: "لوحة التحكم",
    engines: "المحركات",
    history: "سجل التشغيل",
    alerts: "التنبيهات",
    docs: "التوثيق",
  },
  common: {
    run: "تشغيل",
    running: "جارٍ التنفيذ…",
    input: "المدخلات",
    output: "النتيجة",
    export: "تصدير",
    exportPdf: "تصدير PDF",
    exportCsv: "تصدير CSV",
    verify: "تحقّق",
    verified: "تم التحقق",
    documentation: "التوثيق",
    equations: "المعادلات",
    parameters: "المعاملات",
    duration: "المدة",
    memory: "الذاكرة",
    status: "الحالة",
    open: "فتح",
    clear: "مسح",
    search: "بحث",
    language: "اللغة",
    workers: "عمّال المعالجة",
    parallelism: "التوازي",
    accuracy: "الدقّة",
    checksum: "بصمة النتيجة",
    rows: "صف",
  },
  engines: {
    integration: {
      name: "التكامل العددي",
      desc: "تكامل مركّب بطريقتَي سيمبسون والشبه المنحرف مع تحسين ريتشاردسون.",
    },
    regression: {
      name: "الانحدار الخطي (OLS)",
      desc: "المربعات الصغرى العادية مع R² والخطأ المعياري وتحليل البواقي.",
    },
    statistics: {
      name: "الإحصاء الوصفي",
      desc: "المتوسط، التباين (Welford)، الشرائح المئوية، الالتواء، التفرطح.",
    },
    fft: {
      name: "تحويل فورييه السريع",
      desc: "خوارزمية Cooley–Tukey جذر-2 مع طيف السعة والطور.",
    },
    ode: {
      name: "حالّ المعادلات التفاضلية (RK4)",
      desc: "رونج–كوتا من الرتبة الرابعة مع تقرير الخطوة التكيّفية.",
    },
  },
  hero: {
    kpiRuns: "إجمالي عمليات التشغيل",
    kpiEngines: "المحركات المتاحة",
    kpiWorkers: "العمّال النشطون",
    kpiAlerts: "التنبيهات المفتوحة",
  },
  history: {
    empty: "لا توجد عمليات تشغيل بعد. شغّل محركاً لتعبئة السجل.",
    columns: {
      time: "الوقت",
      engine: "المحرك",
      duration: "م.ث",
      status: "الحالة",
      checksum: "البصمة",
    },
  },
  alerts: {
    empty: "لا تنبيهات.",
    threshold: "تجاوز عتبة",
    completed: "اكتمل التشغيل",
    failed: "فشل التشغيل",
  },
};

if (!i18n.isInitialized) {
  const initial =
    typeof window !== "undefined"
      ? window.localStorage.getItem("pes.lang") ?? "en"
      : "en";
  void i18n.use(initReactI18next).init({
    resources: { en: { t: en }, ar: { t: ar } },
    lng: initial,
    fallbackLng: "en",
    defaultNS: "t",
    interpolation: { escapeValue: false },
  });
}

export function setLanguage(lng: "en" | "ar") {
  void i18n.changeLanguage(lng);
  if (typeof window !== "undefined") {
    window.localStorage.setItem("pes.lang", lng);
    document.documentElement.lang = lng;
    document.documentElement.dir = lng === "ar" ? "rtl" : "ltr";
  }
}

export default i18n;