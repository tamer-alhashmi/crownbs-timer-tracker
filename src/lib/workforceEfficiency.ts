export type WorkforceEfficiencyLog = {
  status: string;
  start_time: string | null;
  end_time: string | null;
  rooms_completed: number | null;
  service_name_snapshot: string | null;
  service_unit: string | null;
  dispatch_metadata: unknown;
};

export type WorkforceEfficiency = {
  score: number | null;
  scoredTasks: number;
  unscoredTasks: number;
};

const ROOM_TARGET_PER_HOUR = 2;

export function calculateWorkforceEfficiency(
  logs: readonly WorkforceEfficiencyLog[],
  now = Date.now(),
): WorkforceEfficiency {
  let expectedHours = 0;
  let actualHours = 0;
  let scoredTasks = 0;
  let unscoredTasks = 0;

  for (const log of logs) {
    if (log.status !== "active" && log.status !== "completed") continue;
    const start = log.start_time ? Date.parse(log.start_time) : Number.NaN;
    const end = log.end_time ? Date.parse(log.end_time) : log.status === "active" ? now : Number.NaN;
    const elapsedHours = (end - start) / 3_600_000;
    if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) continue;

    const isRoomTask = log.service_unit === "per_room"
      || /\b(room|housekeep|cleaning)\b/i.test(log.service_name_snapshot ?? "");
    let taskTargetHours: number | null = null;
    if (isRoomTask) {
      const completedRooms = Number(log.rooms_completed);
      if (Number.isFinite(completedRooms) && completedRooms > 0) {
        taskTargetHours = completedRooms / ROOM_TARGET_PER_HOUR;
      }
    } else {
      const durationHours = typeof log.dispatch_metadata === "object"
        && log.dispatch_metadata !== null
        && !Array.isArray(log.dispatch_metadata)
        && "durationHours" in log.dispatch_metadata
        ? log.dispatch_metadata.durationHours
        : null;
      if (typeof durationHours === "number" && Number.isFinite(durationHours) && durationHours > 0) {
        taskTargetHours = durationHours;
      }
    }

    if (taskTargetHours === null) {
      unscoredTasks += 1;
      continue;
    }
    expectedHours += taskTargetHours;
    actualHours += elapsedHours;
    scoredTasks += 1;
  }

  return {
    score: scoredTasks ? Math.round((expectedHours / actualHours) * 100) : null,
    scoredTasks,
    unscoredTasks,
  };
}
