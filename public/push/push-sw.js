self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.error("Unable to parse push notification payload:", error);
  }
  if (!payload || typeof payload !== "object") payload = {};

  const title = typeof payload.title === "string" ? payload.title : "New task assigned";
  const unreadCount = Number.isSafeInteger(payload.unreadCount) && payload.unreadCount > 0
    ? payload.unreadCount
    : 1;
  const badgeUpdate = typeof navigator.setAppBadge === "function"
    ? Promise.resolve().then(() => navigator.setAppBadge(unreadCount)).catch((error) => {
      console.error("Unable to set the application badge:", error);
    })
    : Promise.resolve();
  const options = {
    body: typeof payload.body === "string"
      ? payload.body
      : typeof payload.message === "string"
        ? payload.message
        : "Open CrownBS to review your notification.",
    icon: typeof payload.icon === "string" ? payload.icon : "/icon-192.png",
    badge: typeof payload.badge === "string" ? payload.badge : "/icon-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : "crownbs-task",
    data: { url: typeof payload.url === "string" ? payload.url : "/dashboard" },
    actions: [
      { action: "view-task", title: "View Task" },
      { action: "dismiss", title: "Dismiss" },
    ],
    requireInteraction: Boolean(payload.requireInteraction),
    vibrate: [150, 80, 150],
  };
  event.waitUntil(Promise.all([badgeUpdate, self.registration.showNotification(title, options)]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const target = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
    const sameOriginClient = windowClients.find((client) => new URL(client.url).origin === self.location.origin);
    if (sameOriginClient && "focus" in sameOriginClient) {
      return sameOriginClient.navigate(target).then(() => sameOriginClient.focus());
    }
    return clients.openWindow(target);
  }));
});
