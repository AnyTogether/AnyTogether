/** The public API page (/developers), English and Turkish. */
const en = {
  meta: {
    title: "Public API · AnyTogether",
    description: "Read what AnyTogether shows everyone from your own tools, with a personal token.",
  },
  kicker: "For developers",
  title: ["Public API", "Read only, with your own token."],
  lead: "Build bots and tools on what AnyTogether shows everyone.",
  cards: [
    {
      title: "Get a token",
      body: "Make one in your account settings and pick what it may read. Send it with every request as a bearer token.",
    },
    {
      title: "Only what is public",
      body: "A token reads as a stranger would. Parts of a profile kept private stay private, and people blocked either way with you are left out.",
    },
    {
      title: "Limits",
      body: "60 requests a minute and 10,000 a day for each token, 120 a minute for all of an account's tokens. Every answer says how many are left.",
    },
  ],
  endpointsTitle: "Endpoints",
  endpointsLead: "Everything is under /api/v1/public and answers JSON. This version only reads.",
  scopeLabel: "Scope",
  noScope: "Any token",
  endpoints: [
    { path: "/token", scope: "", text: "The token in use, with its name and scopes." },
    { path: "/users/{handle}", scope: "profiles:read", text: "A profile card as a stranger sees it." },
    {
      path: "/users/{handle}/library",
      scope: "profiles:read",
      text: "Games and play time, when open to everyone.",
    },
    { path: "/users/{handle}/trophies", scope: "profiles:read", text: "Trophies, when open to everyone." },
    { path: "/games/{titleId}", scope: "leaderboards:read", text: "A game's names and icon." },
    {
      path: "/games/{titleId}/leaderboard",
      scope: "leaderboards:read",
      text: "A game's global board by points, play time or completion.",
    },
    { path: "/leaderboards/points", scope: "leaderboards:read", text: "The overall board by trophy points." },
    { path: "/challenges", scope: "challenges:read", text: "Challenges open to everyone." },
    { path: "/challenges/{id}", scope: "challenges:read", text: "One challenge with its standings." },
  ],
  exampleTitle: "Example",
  final: {
    title: "Start with a token.",
    lead: "The OpenAPI document has every field and every error.",
    token: "Make a token",
    spec: "OpenAPI document",
  },
};

const tr: typeof en = {
  meta: {
    title: "Herkese açık API · AnyTogether",
    description: "AnyTogether'ın herkese gösterdiklerini kendi araçlarından, kişisel bir anahtarla oku.",
  },
  kicker: "Geliştiriciler için",
  title: ["Herkese açık API", "Sadece okur, kendi anahtarınla."],
  lead: "AnyTogether'ın herkese gösterdikleriyle bot ve araç yap.",
  cards: [
    {
      title: "Anahtar al",
      body: "Hesap ayarlarında bir anahtar oluştur ve neyi okuyabileceğini seç. Her istekte onu bearer anahtarı olarak gönder.",
    },
    {
      title: "Sadece herkese açık olan",
      body: "Bir anahtar yabancı biri gibi okur. Gizli tutulan profil bölümleri gizli kalır, seninle aranda engel olan kişiler listelere girmez.",
    },
    {
      title: "Sınırlar",
      body: "Her anahtar için dakikada 60 ve günde 10.000 istek, bir hesabın tüm anahtarları için dakikada 120. Her yanıt kaç istek kaldığını söyler.",
    },
  ],
  endpointsTitle: "Uç noktalar",
  endpointsLead: "Hepsi /api/v1/public altında ve JSON döner. Bu sürüm sadece okur.",
  scopeLabel: "Kapsam",
  noScope: "Her anahtar",
  endpoints: [
    { path: "/token", scope: "", text: "Kullanılan anahtar, adı ve kapsamlarıyla." },
    { path: "/users/{handle}", scope: "profiles:read", text: "Yabancı birinin gördüğü profil kartı." },
    {
      path: "/users/{handle}/library",
      scope: "profiles:read",
      text: "Herkese açıksa oyunlar ve oynama süresi.",
    },
    { path: "/users/{handle}/trophies", scope: "profiles:read", text: "Herkese açıksa kupalar." },
    { path: "/games/{titleId}", scope: "leaderboards:read", text: "Bir oyunun adları ve simgesi." },
    {
      path: "/games/{titleId}/leaderboard",
      scope: "leaderboards:read",
      text: "Bir oyunun puana, oynama süresine ya da tamamlanmaya göre genel sıralaması.",
    },
    { path: "/leaderboards/points", scope: "leaderboards:read", text: "Kupa puanına göre genel sıralama." },
    { path: "/challenges", scope: "challenges:read", text: "Herkese açık meydan okumalar." },
    { path: "/challenges/{id}", scope: "challenges:read", text: "Bir meydan okuma ve sıralaması." },
  ],
  exampleTitle: "Örnek",
  final: {
    title: "Bir anahtarla başla.",
    lead: "OpenAPI belgesinde her alan ve her hata var.",
    token: "Anahtar oluştur",
    spec: "OpenAPI belgesi",
  },
};

export const developerStrings = (language: string) => (language === "tr" ? tr : en);
