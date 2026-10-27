// One line in the staff bell, ready to show.
export interface NotificationItem {
  id: string;
  text: string; // "New online booking from Chidi Okeke"
  orderNumber: string; // "FF-1024"
  time: string; // "Tue, 27 Oct 2026, 2:15 PM", store time
  href: string; // the order
  isNew: boolean; // unread until this opening of the bell
}

// What the count request returns.
export interface UnreadCountResponse {
  count: number;
}

// What opening the bell returns.
export interface OpenedNotificationsResponse {
  items: NotificationItem[];
}
