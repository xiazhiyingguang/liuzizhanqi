import { AVAILABLE_HERO_IDS, createHero } from './heroes';
import { getSkill } from './skills';
import { HeroClass, SkillType } from '../types/game';

export type CodexAbility = {
    name: string;
    description: string;
};

export type HeroCodexEntry = {
    id: string;
    name: string;
    class: HeroClass;
    maxHp: number;
    moveRange: number;
    baseAttack: number;
    skills: Array<CodexAbility & { type: SkillType; range: number; rangeType: string }>;
    epithet: string;
    role: string;
    summary: string;
    difficulty: 1 | 2 | 3;
    tags: string[];
    resource?: string;
    passive: CodexAbility;
    tianwei?: CodexAbility;
    tips: string[];
};

type CodexWriting = Omit<
    HeroCodexEntry,
    'id' | 'name' | 'class' | 'maxHp' | 'moveRange' | 'baseAttack' | 'skills'
> & { skillNames?: [string, string] };

const WRITING: Record<string, CodexWriting> = {
    moran: {
        skillNames: ['入道', '墨断'],
        epithet: '行墨问道',
        role: '持续输出 · 额外行动',
        summary: '通过技能强化与受击触发争取额外行动，在一轮中连续改写战局。',
        difficulty: 2,
        tags: ['再动', '成长伤害', '反打'],
        resource: '为道状态与每轮天威次数',
        passive: { name: '为道', description: '处于“为道”状态时，累计受到两次攻击后立即获得一次额外行动，并移除“为道”。' },
        tianwei: { name: '天威 · 再行', description: '击杀敌人后立即获得一次额外行动，每轮最多触发一次。' },
        tips: ['先用技能获得“为道”，再主动站到可承受的火力线上。', '额外行动不会消耗正常行动次数，适合完成收割或及时撤离。'],
    },
    zhenxiao: {
        skillNames: ['雷血开锋', '金银错'],
        epithet: '雷甲撼阵',
        role: '近战反击 · 吸血续航',
        summary: '以高生命贴近敌阵，开启反击后用伤害与吸血逼迫对手改变攻击顺序。',
        difficulty: 1,
        tags: ['反击', '吸血', '近战'],
        resource: '金银错状态',
        passive: { name: '金银错', description: '处于“金银错”状态时，受到敌方伤害后回击6点伤害，并回复实际伤害50%的生命。' },
        tianwei: { name: '天威 · 震域', description: '击杀敌人后吸取周围一格内所有敌人的生命；敌人越多，总伤害与回复越高。' },
        tips: ['让震霄卡住敌方多人相邻的位置，天威收益最高。', '反击依赖“金银错”，开启状态后再承担火力。'],
    },
    huifeng: {
        epithet: '回刃听锋',
        role: '连击爆发 · 地形压制',
        summary: '在敌人身上叠加连破与锋鸣，以自动连斩和刃痕持续制造压力。',
        difficulty: 2,
        tags: ['连击', '自动追击', '刃痕'],
        resource: '锋鸣层数与刃痕位置',
        passive: { name: '锋鸣', description: '攻击带有“连破”的目标时获得锋鸣；累计3层会自动释放一次连刃斩。' },
        tianwei: { name: '天威 · 刃痕', description: '击杀敌人后，在自身上下左右四格留下持续3轮的刃痕。' },
        tips: ['集中攻击同一名带有连破的目标，更快触发连刃斩。', '收割前调整站位，让天威生成的刃痕封住关键通路。'],
    },
    wukong: {
        skillNames: ['毫毛化身', '大圣合击'],
        epithet: '万相灵猴',
        role: '分身协击 · 暴击成长',
        summary: '召唤分身扩张战线，借分身阵亡积累灵犀，逐步提升全体暴击能力。',
        difficulty: 3,
        tags: ['召唤', '暴击', '多单位'],
        resource: '分身数量（最多3）与灵犀',
        passive: { name: '灵犀', description: '每有一个自己的分身阵亡，获得1点灵犀，使悟空与现存分身的暴击率提高20%，最高100%。' },
        tianwei: { name: '天威 · 毫毛化身', description: '击杀敌人后，在相邻空位立即召唤一个10生命分身；场上自己的分身最多3个。' },
        tips: ['分身既能协击也能占位，不必一味保护；合理牺牲可以换取暴击成长。', '召唤前预留相邻空格，否则天威无法生成分身。'],
    },
    xuanxiao: {
        epithet: '玄光司命',
        role: '增益辅助 · 队友再动',
        summary: '强化核心队友并重置其行动，把一位英雄的爆发窗口放大为两次。',
        difficulty: 2,
        tags: ['增益', '再动', '保命'],
        resource: '玄光增益与化险为夷',
        passive: { name: '化险为夷', description: '生命首次降至16以下后蓄势；下一次受到的伤害会改为等量治疗，每场战斗触发一次。' },
        tips: ['让高爆发或拥有击杀天威的队友再动，价值通常最高。', '低血触发化险后可以大胆承受一次重击，但仍要留意控制与持续伤害。'],
    },
    nightowl: {
        epithet: '暗影猎手',
        role: '潜行刺杀 · 单点收割',
        summary: '用死亡标记锁定猎物，潜行规避单体攻击后完成高效刺杀。',
        difficulty: 2,
        tags: ['潜行', '标记', '无视防御'],
        resource: '潜行与猎杀标记',
        passive: { name: '影遁', description: '潜行时免疫单体伤害；受到范围伤害时，每轮承受的范围伤害总量最多为10点。' },
        tianwei: { name: '天威 · 暗行', description: '击杀敌人后立即进入潜行，并使下一次攻击无视目标50%的防御。' },
        tips: ['优先标记能稳定击杀的目标，以天威刷新潜行形成连续收割。', '范围攻击仍能命中潜行单位，避免长期停留在敌方范围技能中心。'],
    },
    liuli: {
        epithet: '琉光守心',
        role: '援护坦克 · 团队减伤',
        summary: '替队友承担伤害并积累禅定，在关键时刻把承伤转化为生存优势。',
        difficulty: 1,
        tags: ['援护', '承伤', '禅定'],
        resource: '禅定层数',
        passive: { name: '守心', description: '每次援护真正替友方承担伤害后，获得1层禅定。' },
        tips: ['将援护放在脆弱但关键的输出或辅助身上。', '注意自己的剩余生命，援护转移的伤害可能让琉璃成为新的突破口。'],
    },
    baize: {
        skillNames: ['瑞泽', '天禄归生'],
        epithet: '瑞兽通明',
        role: '单体治疗 · 复活支援',
        summary: '以稳定治疗维持阵线，并在减员后选择目标与空位完成复活。',
        difficulty: 2,
        tags: ['治疗', '复活', '治疗强化'],
        resource: '白泽之力',
        passive: { name: '白泽图', description: '每轮开始时，为随机两名友方赋予“白泽之力”，提高其受到的治疗效果。' },
        tips: ['白泽复活时由玩家同时选择阵亡目标和复活位置。', '优先治疗带有白泽之力的前排，能获得更高的生命交换效率。'],
    },
    changli: {
        epithet: '长夜燃星',
        role: '复生核心 · 资源续航',
        summary: '积累暗夜星火换取多次复生，在漫长战斗中不断返回战场。',
        difficulty: 2,
        tags: ['复生', '资源积累', '续航'],
        resource: '暗夜星火与复生次数（最多3次）',
        passive: { name: '长夜轮回', description: '阵亡时若拥有足够暗夜星火，则消耗星火并复生；整场战斗最多复生3次。' },
        tianwei: { name: '天威 · 星火', description: '击杀敌人后立即获得4层暗夜星火。' },
        tips: ['用技能稳定积累星火，不要只依赖击杀触发天威。', '复生次数有限，避免在无法改变战局的位置反复消耗资源。'],
    },
    mirror: {
        epithet: '镜界双生',
        role: '镜像操控 · 机动爆发',
        summary: '制造镜像改变站位与威胁方向，并用破镜之刃补足斩杀伤害。',
        difficulty: 3,
        tags: ['镜像', '换位', '自动斩击'],
        resource: '镜像位置与破镜之刃',
        passive: { name: '破镜之刃', description: '获得破镜之刃时立即消耗，对范围内生命最低的敌人释放斩击。' },
        tianwei: { name: '天威 · 破镜', description: '击杀敌人后获得3层破镜之刃，并立即结算对应斩击。' },
        tips: ['镜像可以占位和换位，先规划落点再发动技能。', '让低血敌人进入斩击范围，可使击杀后的天威继续追击。'],
    },
    mowen: {
        skillNames: ['时光回溯', '逆时斩'],
        epithet: '时光剑客',
        role: '闪避生存 · 回溯反打',
        summary: '记录并回溯自身状态，以概率闪避和击杀回复在危险边缘反复周旋。',
        difficulty: 3,
        tags: ['回溯', '闪避', '击杀回复'],
        resource: '生命记录与技能冷却',
        passive: { name: '时间裂隙', description: '受到攻击时有概率完全闪避；生命越低，闪避概率越高。' },
        tianwei: { name: '天威 · 时返', description: '击杀敌人后，回复等同于本次对该目标造成伤害的生命。' },
        tips: ['回溯前先记住当前状态，避免把自己送回更危险的位置。', '低血提高闪避但并非必定生效，应为失败结果保留退路。'],
    },
    guying: {
        skillNames: ['踏雪留影', '寒星碎'],
        epithet: '寒锋孤影',
        role: '冻结控制 · 剑影回收',
        summary: '给敌人施加寒天并积累寒星，再利用冻结和剑影回收控制战场直线。',
        difficulty: 3,
        tags: ['冻结', '寒星', '直线伤害'],
        resource: '寒星（最多5）与剑影位置',
        passive: { name: '寒星', description: '技能命中带有“寒天”的敌人时获得1层寒星，最多5层。' },
        tianwei: { name: '天威 · 归剑', description: '击杀敌人后回收与自己同直线或对角线的剑影，对回收路径上的敌人造成伤害。' },
        tips: ['先施加寒天再连续命中，才能稳定获得寒星。', '布置剑影时考虑未来站位，让回收路径穿过更多敌人。'],
    },
    hanjiangxue: {
        skillNames: ['霜华覆地', '冰晶壁垒'],
        epithet: '凛冬守望',
        role: '群体寒天 · 地形支援',
        summary: '以直线选点制造范围寒天，用冰晶封锁敌方走位并为队友提供冰甲。',
        difficulty: 3,
        tags: ['寒天', '障碍物', '冰甲'],
        resource: '冰晶位置与冰甲',
        passive: { name: '雪誓', description: '回合结束时，为生命百分比最低的友方英雄附加冰甲。' },
        tianwei: { name: '天威 · 凛冬', description: '击杀敌人后，对敌方场上所有存活单位附加1层寒天。' },
        tips: ['冰晶对敌方是障碍物，可以封锁关键通路。', '让技能1的范围覆盖冰晶，可为自己附加冰甲并触发再次释放技能1。', '冰晶被友方获得后消失，需要不断补充。'],
    },
    skeletonking: {
        epithet: '骸骨君王',
        role: '死亡体系 · 护盾复活',
        summary: '把己方减员转化为伤害和护盾，并在暂时阵亡与真正复活之间维持阵线。',
        difficulty: 2,
        tags: ['亡灵共鸣', '暂时阵亡', '复活'],
        resource: '当前阵亡数与亡灵共鸣',
        passive: { name: '骸骨王座', description: '每轮结束时，按当前双方阵亡单位总数获得护盾，每个阵亡单位提供3点，护盾最多10点。' },
        tianwei: { name: '天威 · 骸骨敕令', description: '击杀敌人后，优先复活一名真正阵亡的随机友方；若无人可复活，则治疗生命最低的存活友方。' },
        tips: ['亡骨斩有概率让自己暂时阵亡，使用前确认场上仍有其他存活友方。', '亡灵共鸣记录累计死亡，可持续强化亡灵唤回。'],
    },
    jetzmi: {
        epithet: '亡灵城主',
        role: '双形态爆发 · 亡灵复苏',
        summary: '通过暂时阵亡在城主与终焉国王间切换，两种形态拥有不同的攻击与续航方式。',
        difficulty: 3,
        tags: ['双形态', '暂时阵亡', '吸血'],
        resource: '当前形态、亡灵共鸣与吸血倍率',
        passive: { name: '终焉王座', description: '自身暂时阵亡时切换形态：城主转为终焉国王，终焉国王则转回城主。' },
        tianwei: { name: '天威 · 共鸣', description: '击杀敌人后获得2点亡灵共鸣。' },
        tips: ['城主形态可消耗2点共鸣强化终焉斩攻击第二目标；国王形态伤害更依赖共鸣。', '技能导致的暂时阵亡会原地切换形态（不下场），但仍计入亡灵共鸣；真实死亡才会离场。'],
    },
    pipa: {
        epithet: '五弦清商',
        role: '追击辅助 · 单点爆发',
        summary: '给队友附上音符，将队友攻击转化为附伤与和弦，再集中引爆。',
        difficulty: 2,
        tags: ['音符', '追击', '治疗'],
        resource: '和弦层数',
        passive: { name: '余音', description: '自身行动结束时，按身边存活友方数量回复生命，每名友方提供2点，最多回复5点。' },
        tianwei: { name: '天威 · 回响', description: '击杀敌人后，治疗生命最低的友方，治疗量等于本次和弦爆发造成的伤害。' },
        tips: ['把音符给行动频率高或容易连续攻击的队友。', '和弦不会自动清空，等到能确保击杀时再用和弦爆发收益更高。'],
    },
    bounty: {
        epithet: '黄金猎令',
        role: '击杀悬赏 · 集火追击',
        summary: '开局向敌方全员发布随机悬赏，用猎杀令锁定目标让全队集火，猎人持续补枪并收割赏金。',
        difficulty: 2,
        tags: ['悬赏', '集火', '追击'],
        resource: '悬赏奖励与猎杀令目标',
        passive: { name: '悬赏令', description: '战斗开始时，向敌方所有存活单位随机发布一枚悬赏；被击杀时实际击杀者领取对应奖励。' },
        tianwei: { name: '天威 · 追猎', description: '击杀敌人后，向随机一名存活敌人追加猎杀令。' },
        tips: ['用猎杀令锁定一名敌人，全队集火时猎人会自动追击补枪。', '赏金奖励可能是再次触发天威、回复已损生命、永久暴击或永久吸血。'],
    },
    yinyang: {
        epithet: '两仪执契',
        role: '链接辅助 · 攻防操控',
        summary: '以阳线强化友方、阴线削弱敌方；重复链接同一目标会产生额外结算。',
        difficulty: 3,
        tags: ['链接', '增益', '削弱'],
        resource: '阴阳链接与效果倍率',
        passive: { name: '两仪流转', description: '阴、阳攻防效果每轮提高5%（上限50%）；重复连接同一目标会使恢复/伤害效果+10%（上限50%）；链接目标切换或超出两格范围时，攻防与重复倍率均重置为20%。' },
        tianwei: { name: '天威 · 借威', description: '击杀敌人后，触发当前阳线所链接友方的天威。' },
        tips: ['重复对同一友方施加阳线会治疗其已损失生命；重复阴线会削减敌人当前生命。', '可链接拥有强力击杀天威的队友，形成连锁触发。'],
    },
    soul_lamp: {
        epithet: '幽冥引灯',
        role: '死亡辅助 · 延迟复活',
        summary: '主动化为魂灯维持暗域，以自身风险换取队友吸血、复活和亡魂资源。',
        difficulty: 3,
        tags: ['法阵', '暂时阵亡', '延迟复活'],
        resource: '亡魂数与吸血倍率',
        passive: { name: '缚魂灯芯', description: '每次暂时阵亡时，可指定一名存活友方获得临时吸血（初始30%），并使吸血率+20%（上限90%）；自己复活后临时吸血消失，真实死亡时按当前吸血率永久生效。魂灯暂时阵亡时，法阵内友方的暂时阵亡可使其复苏。' },
        tips: ['点灯后自身会暂时阵亡，务必确保还有存活友方，否则立即失败。', '缚魂轮转会令队友下轮复活，血量=阵亡时生命+亡灵之魂×20%最大生命；使用时魂灯会真正阵亡。'],
    },
    hero_x: {
        epithet: '无名震怒',
        role: '控制前排 · 伤害转移',
        summary: '靠近敌人积累震怒，靠团队行动积累增势，在眩晕与伤害转移之间保护阵线。',
        difficulty: 2,
        tags: ['震怒', '眩晕', '伤害转移'],
        resource: '震怒与增势',
        passive: { name: '不屈增势', description: '每轮结束时，按两格内敌人数积累震怒，达到3点时眩晕附近敌人；友方行动会积累增势，每3点可将下一次伤害转移给玩家选择的友方，并将伤害减半。' },
        tips: ['传送到友方身边既能给护盾，也能加快增势积累。', '伤害转移前要选择生命充足的友方，避免救下一人却击倒另一人。'],
    },
    bard: {
        epithet: '长歌抚阵',
        role: '群体治疗 · 激情循环',
        summary: '用和声连接周围友军，通过队友攻击积累激情，再释放高额治疗。',
        difficulty: 1,
        tags: ['和声', '群体治疗', '低血自救'],
        resource: '全队激情总量',
        passive: { name: '终曲回响', description: '生命低于40%时受到伤害后，消耗全队激情并按总激情×3治疗自己。' },
        tips: ['尽量让和声覆盖即将攻击的队友，每次攻击都能获得激情并回复生命。', '低血被动会消耗激情，若准备主动治疗，应留意触发顺序。'],
    },
    wither_lord: {
        epithet: '三命凋零',
        role: '叠层爆发 · 多命续战',
        summary: '在敌群中铺设凋零层数，用生命上限百分比伤害引爆，并以多条生命抵消死亡。',
        difficulty: 3,
        tags: ['范围叠层', '百分比伤害', '多条生命'],
        resource: '凋零层数与剩余生命条数',
        passive: { name: '不灭凋零', description: '初始拥有3条生命；致死时消耗一条生命并恢复。累计施加每6层凋零，额外获得一条生命。' },
        tianwei: { name: '天威 · 续命', description: '击杀敌人后增加一条生命。' },
        tips: ['先用凋零领域命中多名敌人快速累计层数，再选择高层目标引爆。', '引爆会提高自身的死亡风险，不要把多条生命当成无限资源。'],
    },
    t_painting: {
        epithet: '帛上神游',
        role: '双召唤 · 区域压制',
        summary: '召唤金乌与玄龟形成三单位体系，分别负责范围爆发与控制。',
        difficulty: 3,
        tags: ['召唤', '范围伤害', '控制'],
        resource: '金乌与玄龟的存活状态',
        passive: { name: '帛画神性', description: '每有一个自己的召唤物存活，T型帛画造成的伤害额外增加1点。召唤物阵亡会使本体损失30%当前生命。' },
        tianwei: { name: '天威 · 神佑', description: '击杀敌人后，为自己、金乌和玄龟各回复8点生命。' },
        tips: ['金乌适合打密集敌群，玄龟适合牵制关键目标。', '本体阵亡会同时移除召唤物；保护本体通常比保护单个召唤物更重要。'],
    },
    feynman: {
        epithet: '粒子加速者',
        role: '标记构型 · 范围爆发',
        summary: '沿直线留下粒子标记，再用两点构成矩形，让几何位置转化为范围伤害。',
        difficulty: 3,
        tags: ['粒子标记', '矩形范围', '技能扩大'],
        resource: '粒子标记与能量',
        passive: { name: '能量跃迁', description: '每次技能造成伤害获得1点能量；每累计3点能量，下一次技能或天威的作用范围扩大。' },
        tianwei: { name: '天威 · 粒子雨', description: '击杀敌人后，在随机位置落下8枚粒子；普通状态命中单格，扩大状态命中3×3区域。' },
        tips: ['粒子矩阵需要选择两个已有标记，尽量让矩形覆盖更多敌人。', '在即将达到3能量时规划下一个技能，避免把扩大效果浪费在低价值目标上。'],
    },
    wangcai: {
        epithet: '通灵财神',
        role: '成长输出 · 团队投资',
        summary: '给队友施加来财并从其行动中积累财气，达到阈值后通灵财神完成永久成长。',
        difficulty: 2,
        tags: ['财气', '永久成长', '友方增益'],
        resource: '财气（7点通灵）与基础攻击',
        passive: { name: '财神通灵', description: '获得7点财气时仅触发一次通灵：若已阵亡则满生命复活，否则回复50%生命；通灵后每获得1点财气，永久增加1点基础攻击。' },
        tianwei: { name: '天威 · 旺运', description: '击杀敌人后永久增加2点基础攻击。' },
        tips: ['来财可同时给两名队友，受益者行动时会为旺财提供财气。', '通灵后的技能伤害会放大财气与基础攻击，越拖后期越强。'],
    },
    schrodinger: {
        epithet: '量子观测者',
        role: '概率爆发 · 空间操控',
        summary: '让每次技能在伤害与免疫之间坍缩，并以量子纠缠共享生命变化。',
        difficulty: 3,
        tags: ['概率', '量子纠缠', '全场传送'],
        resource: '坍缩层数与纠缠目标',
        passive: { name: '观测效应', description: '每次使用技能有50%概率获得额外行动，每轮最多一次；上次攻击未受伤的目标，下次受到薛定谔攻击时伤害提高50%。' },
        tianwei: { name: '天威 · 跃迁', description: '击杀敌人后，由玩家选择任意空位传送；落点两格内的敌人各有50%概率受到6点伤害。' },
        tips: ['量子纠缠只显示玩家可理解的状态名，内部链接信息不会出现在界面。', '概率技能要同时准备成功与失败两套走法，不要把唯一胜负手押在一次坍缩上。'],
    },
    lilith: {
        epithet: '恐惧编织者',
        role: '群体控制 · 情绪爆发',
        summary: '散播恐惧削弱敌人并积累情绪能量，再把控制资源转化为高额伤害。',
        difficulty: 2,
        tags: ['恐惧', '行动失败', '扩散'],
        resource: '恐惧情绪能量',
        passive: { name: '噬惧', description: '敌人因恐惧而行动失败时，获得1点恐惧情绪能量，并使莉莉丝的下一次技能伤害提高30%。' },
        tianwei: { name: '天威 · 梦魇', description: '击杀敌人后，使所有敌人获得1轮恐惧，并分别有50%概率受到10点伤害。' },
        tips: ['先给目标施加恐惧，再用噩梦扩散影响更多敌人。', '恐惧降低攻击且可能阻止行动，优先控制敌方高爆发核心。'],
    },
};

export const SKILL_TYPE_LABELS: Record<SkillType, string> = {
    damage: '伤害',
    heal: '治疗',
    buff: '增益',
    debuff: '削弱',
    summon: '召唤',
    special: '特殊',
    control: '控制',
};

export const HERO_CODEX: HeroCodexEntry[] = AVAILABLE_HERO_IDS.map(id => {
    const hero = createHero(id, 'player1');
    const writing = WRITING[id];
    if (!writing) throw new Error(`Missing codex writing for hero: ${id}`);
    const { skillNames, ...playerWriting } = writing;

    const skills = [hero.skill1Id, hero.skill2Id].map((skillId, index) => {
        const skill = getSkill(skillId);
        if (!skill) throw new Error(`Missing skill ${skillId} for codex hero: ${id}`);
        return {
            name: skillNames?.[index] ?? skill.name,
            description: skill.description,
            type: skill.type,
            range: skill.range,
            rangeType: skill.rangeType,
        };
    });

    return {
        id,
        name: hero.name,
        class: hero.class,
        maxHp: hero.maxHp,
        moveRange: hero.moveRange,
        baseAttack: hero.baseAttack ?? 0,
        skills,
        ...playerWriting,
    };
});

export const HERO_CLASSES = Array.from(new Set(HERO_CODEX.map(hero => hero.class)));
