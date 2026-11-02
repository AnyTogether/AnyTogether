/** The status one picks (Online, Idle, Do Not Disturb, Invisible, as on Discord): the choice in the
 *  settings, the mark on one's own avatar and the words beside a friend. */
export const presenceEn = {
  presenceMode: "Your status",
  presenceOnline: "Online",
  presenceIdle: "Idle",
  presenceDnd: "Do Not Disturb",
  presenceAppearOffline: "Invisible",
  presenceHint_online: "Friends see you online.",
  presenceHint_idle: "Friends see you as idle. Messages and invites still reach you.",
  presenceHint_dnd:
    "Friends see that you would rather not be disturbed. Messages and invites still reach you.",
  presenceHint_invisible: "Friends see you as offline. Messages, parties and cloud saves keep working.",
  appearingOffline: "You are invisible",
  statusMark_idle: "You are idle",
  statusMark_dnd: "Do Not Disturb is on",
  stateIdle: "Idle",
  stateDnd: "Do Not Disturb",
};

export const presenceTr: typeof presenceEn = {
  presenceMode: "Durumun",
  presenceOnline: "Çevrimiçi",
  presenceIdle: "Boşta",
  presenceDnd: "Rahatsız etmeyin",
  presenceAppearOffline: "Görünmez",
  presenceHint_online: "Arkadaşların seni çevrimiçi görür.",
  presenceHint_idle: "Arkadaşların seni boşta görür. Mesajlar ve davetler yine gelir.",
  presenceHint_dnd: "Arkadaşların rahatsız edilmek istemediğini görür. Mesajlar ve davetler yine gelir.",
  presenceHint_invisible:
    "Arkadaşların seni çevrimdışı görür. Mesajlar, partiler ve bulut kayıtları çalışmaya devam eder.",
  appearingOffline: "Görünmezsin",
  statusMark_idle: "Boştasın",
  statusMark_dnd: "Rahatsız etmeyin açık",
  stateIdle: "Boşta",
  stateDnd: "Rahatsız etmeyin",
};
