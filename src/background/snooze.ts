import { db } from "../store/db";

const ALARM_PREFIX = "neoinbox-snooze-";

export async function snoozeMessage(
  messageId: number,
  wakeAt: number,
): Promise<void> {
  await db.snoozes.put({ messageId, wakeAt });
  await messenger.alarms.create(`${ALARM_PREFIX}${messageId}`, { when: wakeAt });
  console.debug("[NeoInbox] snoozed", messageId, "until", new Date(wakeAt));
}

export async function handleSnoozeAlarm(alarmName: string): Promise<void> {
  if (!alarmName.startsWith(ALARM_PREFIX)) return;
  const messageId = parseInt(alarmName.slice(ALARM_PREFIX.length), 10);
  if (isNaN(messageId)) return;
  await db.snoozes.delete(messageId);
  console.info("[NeoInbox] snooze woke", messageId);
}
