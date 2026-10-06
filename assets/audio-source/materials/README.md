# 材质音效录音来源

用于生成五类战斗材质音效。以下 Freesound 页面已核对为 CC0-1.0；作者、原页面、HQ 预览下载地址与 SHA-256 保存在 `sources.json`。下载的是公开 HQ MP3 预览，不是原始无损录音。对应 WAV 为浏览器 Web Audio 解码至 44.1kHz 单声道的工作文件，浪声只保留前 30 秒；这些工作素材不进入游戏的 public 目录。

| 工作文件 | 原录音 | 作者 | 处理与用途 |
| --- | --- | --- | --- |
| ice | [Ice cracking](https://freesound.org/people/timbreknight/sounds/342546/) | timbreknight | 多段自然裂声，剪辑、变速、高通；冰裂主体和碎屑 |
| metal | [Metal Clang sound](https://freesound.org/people/kermite607/sounds/362625/) | kermite607 | 印章机械释放的碰撞，剪辑；轻金属撞击层 |
| steel | [Tube hit 08, high+ringing](https://freesound.org/people/dersinnsspace/sounds/435223/) | dersinnsspace | 金属管撞击与自然振动，剪辑、变速；轻刃余韵 |
| heavy-metal | [ANI Big Pipe Hit](https://freesound.org/people/ani_music/sounds/244983/) | ani_music | 低沉金属管撞击，变速；重棒与重击 |
| splash | [Water drop / Splash](https://freesound.org/people/bxyorna/sounds/410335/) | bxyorna | 拍溅主体及后续水滴，剪辑、滤波、变速 |
| waves | [Waves Close-Up](https://freesound.org/people/SKrafft/sounds/681374/) | SKrafft | 近岸浪与水沫，剪辑；起手、浪峰泡沫层 |
| wind | [wind_howling_04.wav](https://freesound.org/people/Fasolt/sounds/113176/) | Fasolt | 办公楼内风声，剪辑、滤波；风的气流，以及魂火变速气息 |
| fire | [fire-crackling.wav](https://freesound.org/people/jmehlferber/sounds/370938/) | jmehlferber | 壁炉火焰，倒放、变速、滤波；魂火与枪焰的细节层 |

许可证：[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。魂火属于设计音效，额外使用合成的低鸣、声道共振与短反射；并非真实人声或所谓“鬼魂录音”。

重现：先运行 `python scripts/fetch-material-foley.py`，再运行 `node scripts/decode-material-foley.mjs`，最后运行 `node scripts/generate-material-sounds.mjs`。已下载源文件和解码 WAV 会复用，日常重造音效只需最后一步。生成文件名包含内容哈希，防止客户端继续读到上一版缓存。
