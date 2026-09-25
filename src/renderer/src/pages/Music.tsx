/**
 * 音乐播放页
 * - 顶部搜索栏(从 searchMusic 获取结果)+ 音乐源选择(kw/wy/tx 等,默认 kw)
 * - 左侧:搜索结果 / 榜单歌曲列表
 * - 右侧:歌词(按时间戳对齐,高亮当前行;无歌词显示"暂无歌词")
 * - 底部固定播放控制栏:播放/暂停、上一首/下一首、进度条(可拖动)、音量、歌曲信息
 * - 播放使用 HTML5 <audio> 元素(不需要 Artplayer)
 * - 自动下一首:播放结束后自动播放列表下一首
 *
 * 实现已拆分到 pages/music/ 目录:
 * - types.ts            共享类型 / SOURCES / parseLyric
 * - useMusicBoards.ts   榜单数据
 * - useMusicHistory.ts  播放历史
 * - useMusicSearch.ts   搜索
 * - useSpectrum.ts      频谱可视化(Web Audio + Canvas)
 * - useMusicPlayer.ts   播放器状态/加载播放/控制/音量/进度
 * - useLyrics.ts        歌词解析/卡拉OK/滚动
 * - Music*.tsx          展示组件(顶部栏/榜单标签/歌曲列表/歌词面板/播放栏)
 */
import { useState } from 'react'
import { useMusicBoards } from './music/useMusicBoards'
import { useMusicHistory } from './music/useMusicHistory'
import { useMusicSearch } from './music/useMusicSearch'
import { useSpectrumCore, useSpectrumRender } from './music/useSpectrum'
import { useMusicPlayer } from './music/useMusicPlayer'
import { useLyrics } from './music/useLyrics'
import MusicHeader from './music/MusicHeader'
import MusicBoardTabs from './music/MusicBoardTabs'
import MusicSongList from './music/MusicSongList'
import MusicLyricPanel from './music/MusicLyricPanel'
import MusicPlayerBar from './music/MusicPlayerBar'

export default function Music() {
  /* ============ 音乐源 ============ */
  const [source, setSource] = useState('kw')

  /* ============ 数据 hooks ============ */
  const history = useMusicHistory()
  const boards = useMusicBoards(source)
  const search = useMusicSearch(source, () => history.setShowHistory(false))

  /* ============ 频谱 + 播放器 ============ */
  const spectrum = useSpectrumCore()
  const player = useMusicPlayer({
    audioCtxRef: spectrum.audioCtxRef,
    initVisualizer: spectrum.initVisualizer,
    setHistorySongs: history.setHistorySongs
  })
  useSpectrumRender(spectrum, player.isPlaying)

  /* ============ 歌词 ============ */
  const lyric = useLyrics(player.lyricData, player.currentTime, player.duration)

  /* ============ 切换音乐源 ============ */
  const handleSourceChange = (id: string) => {
    if (id === source) return
    setSource(id)
    // 切源后回到榜单模式,清空搜索
    search.clearSearch()
  }

  /* ============ 派生值 ============ */
  const isSearchMode = search.submittedKeyword !== ''
  const displayList = history.showHistory ? history.historySongs : (isSearchMode ? search.searchResults : boards.boardSongs)
  const currentSong = player.currentIndex >= 0 ? player.playlist[player.currentIndex] : undefined
  const progressRatio = player.duration > 0 ? player.currentTime / player.duration : 0

  /* ============ 渲染 ============ */
  return (
    <div className="relative h-full flex flex-col">
      {/* ============ 顶部:搜索栏 + 源选择(紧凑布局) ============ */}
      <MusicHeader
        keyword={search.keyword}
        onKeywordChange={search.setKeyword}
        onSearch={search.handleSearch}
        onClearSearch={search.clearSearch}
        source={source}
        onSourceChange={handleSourceChange}
      />

      {/* ============ 榜单/历史标签(非搜索模式) ============ */}
      {!isSearchMode && (
        <MusicBoardTabs
          boards={boards.boards}
          currentBoardId={boards.currentBoardId}
          showHistory={history.showHistory}
          historyCount={history.historySongs.length}
          onSelectHistory={() => { history.setShowHistory(true); boards.setCurrentBoardId('') }}
          onSelectBoard={(id) => { boards.handleBoardChange(id); history.setShowHistory(false) }}
        />
      )}

      {/* ============ 中间内容区 ============ */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧:歌曲列表 */}
        <MusicSongList
          searching={search.searching}
          loadingBoards={boards.loadingBoards}
          displayList={displayList}
          isSearchMode={isSearchMode}
          submittedKeyword={search.submittedKeyword}
          searchCount={search.searchResults.length}
          showHistory={history.showHistory}
          historyCount={history.historySongs.length}
          boardCount={boards.boardSongs.length}
          currentSong={currentSong}
          isPlaying={player.isPlaying}
          onPlaySong={player.handlePlaySong}
        />

        {/* 右侧:歌词 */}
        <MusicLyricPanel
          currentSong={currentSong}
          karaokeMode={lyric.karaokeMode}
          onToggleKaraoke={() => lyric.setKaraokeMode(!lyric.karaokeMode)}
          lyricColor={lyric.lyricColor}
          onLyricColorChange={lyric.setLyricColor}
          lyricFontSize={lyric.lyricFontSize}
          onLyricFontSizeChange={lyric.setLyricFontSize}
          lyricLines={lyric.lyricLines}
          currentLyricIndex={lyric.currentLyricIndex}
          karaokeProgress={lyric.karaokeProgress}
          lyricScrollRef={lyric.lyricScrollRef}
          activeLyricRef={lyric.activeLyricRef}
        />
      </div>

      {/* ============ 底部:播放控制栏(固定) ============ */}
      <MusicPlayerBar
        currentSong={currentSong}
        hasPlaylist={player.playlist.length > 0}
        isPlaying={player.isPlaying}
        loadingUrl={player.loadingUrl}
        onTogglePlay={player.togglePlay}
        onPrev={player.playPrev}
        onNext={player.playNext}
        currentTime={player.currentTime}
        duration={player.duration}
        progressRatio={progressRatio}
        progressBarRef={player.progressBarRef}
        onProgressMouseDown={player.onProgressMouseDown}
        volume={player.volume}
        muted={player.muted}
        onToggleMute={player.toggleMute}
        onVolumeChange={player.handleVolumeChange}
        canvasRef={spectrum.canvasRef}
        spectrumColor={spectrum.spectrumColor}
        onSpectrumColorChange={spectrum.setSpectrumColor}
      />

      {/* ============ 错误提示 ============ */}
      {player.playError && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-500/20 text-red-300 text-xs backdrop-blur-sm border border-red-500/30 animate-fadeIn z-20 rounded">
          {player.playError}
        </div>
      )}

      <audio
        ref={player.audioRef}
        onLoadedMetadata={player.onLoadedMetadata}
        onTimeUpdate={player.onTimeUpdate}
        onEnded={player.onEnded}
        onPlay={player.onPlay}
        onPause={player.onPause}
        onError={player.onError}
      />
    </div>
  )
}
