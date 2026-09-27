/**
 * 职业（体系）配色与题词。
 * 英雄图鉴与武器图鉴共用同一份，两个界面才不会出现同一职业两种颜色。
 */
export const CLASS_THEME: Record<string, { color: string; soft: string; label: string }> = {
    武曲: { color: '#a7372d', soft: 'rgba(167,55,45,.10)', label: '破阵之锋' },
    天师: { color: '#a97720', soft: 'rgba(169,119,32,.11)', label: '术法之枢' },
    猎户: { color: '#26705a', soft: 'rgba(38,112,90,.10)', label: '逐影之矢' },
    霸魁: { color: '#324e80', soft: 'rgba(50,78,128,.10)', label: '镇岳之壁' },
    素问: { color: '#4d7b60', soft: 'rgba(77,123,96,.10)', label: '济世之心' },
    化识: { color: '#74558f', soft: 'rgba(116,85,143,.10)', label: '万象之变' },
    通灵: { color: '#96702f', soft: 'rgba(150,112,47,.11)', label: '灵契之媒' },
    科学家: { color: '#246a78', soft: 'rgba(36,106,120,.10)', label: '格物之理' },
    神话: { color: '#8e5632', soft: 'rgba(142,86,50,.10)', label: '神迹之遗' },
};

export function classTheme(heroClass: string) {
    return CLASS_THEME[heroClass] ?? { color: '#3d3d3d', soft: 'rgba(61,61,61,.08)', label: '无定之道' };
}
