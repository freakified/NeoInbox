declare namespace messenger {
  namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
      periodInMinutes?: number;
    }
    interface AlarmCreateInfo {
      when?: number;
      delayInMinutes?: number;
      periodInMinutes?: number;
    }
    function create(name: string, alarmInfo: AlarmCreateInfo): Promise<void>;
    function clear(name?: string): Promise<boolean>;
    function clearAll(): Promise<boolean>;
    function get(name?: string): Promise<Alarm | undefined>;
    function getAll(): Promise<Alarm[]>;
    const onAlarm: WebExtEvent<(alarm: Alarm) => void>;
  }
}
