// The same catalogue is used by the browser and both authenticated services.
export const courseProjects = [
  { id: 'capstone-patrol', title: '项目二 · 轮式机器人导航与巡检', description: '从底盘通信到建图、定位和到点导航，完成轮式机器人巡检，并核验运行日志与巡检结果。', outcomes: '地图与导航配置、正常及故障场景证据、巡检结果说明。' },
  { id: 'robot-manipulation', title: '项目三 · 机械臂无序试管分拣', description: '学习机械臂运动学、路径规划和抓取，完成无序试管识别、取放与分拣结果核验。', outcomes: '坐标与姿态计算、夹持和取放顺序、放置结果证据。' },
  { id: 'capstone-mobile-agent', title: '项目四 · 人形机器人语义导航', description: '用自然语言描述任务，结合历史观察与语义记忆寻找目标，并验证导航与当前观察是否一致。', outcomes: '语义任务方案、位置与观察记录、导航结果核验；实机环境按项目安排接入。' },
  { id: 'capstone-dual-arm', title: '项目五 · 人形机器人双臂协同操作', description: '围绕双臂交接与分类放置，学习感知、任务分配、相对位姿和状态同步，分析恢复与停止条件。', outcomes: '协作流程、标定与轨迹方案、正常和异常恢复证据。' },
  { id: 'capstone-quadruped', title: '项目六 · 机器人系统综合实战', description: '在割草机器人、移动双臂、四足加机械臂三个方向中选一个，完成系统接口、任务执行与证据整理。', outcomes: '系统集成方案、停止条件与指标、运行及核验记录；割草覆盖练习包含在本项目内。' },
];
export const industrialProjects = [
  { id: 'q1', title: 'Q1 四足巡检机器人', url: 'https://omindos.cn/robots/quadruped/', description: '面向矿山巷道和工业设施巡检，开展运动、感知与任务执行的集成验证。', stage: '研发阶段' },
  { id: 'w1', title: 'W1 轮式移动机器人', url: 'https://omindos.cn/robots/wheeled/', description: '围绕轮式移动平台，开展语音交互、建图定位、导航和巡检模块的集成。', stage: '产品样机' },
  { id: 'mda1', title: 'MDA1 移动双臂操作机器人', url: 'https://omindos.cn/robots/mobile-dual-arm/', description: '结合移动底盘与双臂，开展移动、抓取和协同操作的系统研发。', stage: '研发阶段' },
];
// Fall: September–January; spring: February–August, using Beijing time.
export function academicSemester(now = Date.now()) {
  const date = new Date(now + 8 * 3600000), year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
  const startYear = month >= 9 ? year : year - 1, term = month >= 2 && month <= 8 ? 2 : 1;
  return { id: `${startYear}-${startYear + 1}-${term}`, label: `${startYear}—${startYear + 1} 学年${term === 1 ? '秋季' : '春季'}学期` };
}
export function projectCourseIds(courses, projectId) {
  const parents = new Set([projectId, ...courses.filter(c => c.parentProject === projectId).map(c => c.id)]);
  return courses.filter(c => parents.has(c.id) || parents.has(c.parentId)).map(c => c.id);
}
