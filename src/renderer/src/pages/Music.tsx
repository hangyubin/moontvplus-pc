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
 * - useMusicHistory.ts  播放列表/收藏
 * - useMusicSearch.ts   搜索
 * - useSpectrum.ts      频谱可视化(Web Audio + Canvas)
 * - useMusicPlayer.ts   播放器状态/加载播放/控制/音量/进度
 * - useLyrics.ts        歌词解析/卡拉OK/滚动
 * - Music*.tsx          展示组件(顶部栏/榜单标签/歌曲列表/歌词面板/播放栏)
 */
import { useEffect, useRef, useState } from 'react'
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
import { toast } from '../components/Toast'

export default function Music() {
  /* ============ 音乐源 ============ */
  const [source, setSource] = useState('kw')
  const [quality, setQuality] = useState(() => {
    try { return localStorage.getItem('music_quality') || '320k' } catch { return '320k' }
  })
  const handleQualityChange = (q: string) => {
    setQuality(q)
    try { localStorage.setItem('music_quality', q) } catch {}
  }

  /* ============ 数据 hooks ============ */
  const history = useMusicHistory()
  const boards = useMusicBoards(source)
  const search = useMusicSearch(source, () => history.setView('none'))

  /* ============ 频谱 + 播放器 ============ */
  const spectrum = useSpectrumCore()
  const player = useMusicPlayer({
    audioCtxRef: spectrum.audioCtxRef,
    initVisualizer: spectrum.initVisualizer,
    upsertPlaylistSong: history.upsertPlaylistSong,
    quality
  })
  useSpectrumRender(spectrum, player.isPlaying)

  /* ============ 歌词 ============ */
  const lyric = useLyrics(player.lyricData, player.currentTime, player.duration)

  /* ============ 切换音乐源 ============ */
  const handleSourceChange = (id: string) => {
    if (id === source) return
    setSource(id)
    // 保留搜索关键词:有已提交的搜索则用新源自动重新搜索,否则回到榜单模式
    if (search.submittedKeyword) {
      void search.searchWith(search.submittedKeyword, id)
    } else {
      search.clearSearch()
    }
  }

  /* ============ 搜索历史点击 ============ */
  const handleHistorySelect = (q: string) => {
    search.setKeyword(q)
    void search.searchWith(q, source)
  }

  /* ============ 派生值 ============ */
  const isSearchMode = search.submittedKeyword !== ''
  const displayList =
    history.view === 'playlist'
      ? history.playlistSongs
      : isSearchMode
      ? search.searchResults
      : boards.boardSongs
  const currentSong = player.currentIndex >= 0 ? player.playlist[player.currentIndex] : undefined
  const progressRatio = player.duration > 0 ? player.currentTime / player.duration : 0

  /* ============ 收藏(带反馈) ============ */
  const handleToggleFavorite = () => {
    if (!currentSong) return
    const fav = history.toggleFavorite(currentSong)
    toast[fav ? 'success' : 'info'](fav ? `已收藏《${currentSong.name}》` : `已取消收藏《${currentSong.name}》`)
  }

  /* ============ 从播放列表移除 ============ */
  const handleRemoveSong = (song: Parameters<typeof history.removePlaylistSong>[0]) => {
    const isCurrent =
      !!currentSong && currentSong.songId === song.songId && currentSong.source === song.source
    history.removePlaylistSong(song)
    if (isCurrent) {
      // 删当前歌曲:停止播放并清空队列
      player.stopPlay()
    } else {
      // 非当前歌曲:同步移除队列项,防止播放队列与列表错位
      player.removeSongFromQueue(song)
    }
    toast.info(`已从播放列表移除《${song.name}》`)
  }

  /* ============ 清空播放列表 ============ */
  const handleClearPlaylist = () => {
    history.clearPlaylist()
    player.stopPlay()
    toast.success('播放列表已清空')
  }

  /** 判断两首歌是否同一首(用于滚动定位) */
  const currentSongKey = currentSong ? `${currentSong.source}::${currentSong.songId}` : ''

  /* ============ 播放列表视图:当前歌曲行滚动到可视区 ============ */
  useEffect(() => {
    if (history.view !== 'playlist' || !currentSongKey) return
    const safeKey = window.CSS?.escape ? window.CSS.escape(currentSongKey) : currentSongKey
    const row = document.querySelector(`[data-song-key="${safeKey}"]`)
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [history.view, currentSongKey])

  /* ============ 启动时优先播放播放列表中的音乐 ============ */
  const didStartupRef = useRef(false)
  useEffect(() => {
    if (didStartupRef.current || !history.loaded) return
    didStartupRef.current = true
    // 播放列表最近播放的歌曲排在最前,从它开始自动续播
    if (history.playlistSongs.length > 0 && player.playlist.length === 0) {
      player.startPlaylist(history.playlistSongs, 0)
      // 同步切换到播放列表视图,当前歌曲高亮并自动滚动到可见位置
      history.setView('playlist')
      boards.setCurrentBoardId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.loaded, history.playlistSongs])

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
        history={search.history}
        onHistorySelect={handleHistorySelect}
        onHistoryRemove={search.removeHistory}
        onHistoryClear={search.clearHistory}
      />

      {/* ============ 榜单/历史标签(非搜索模式) ============ */}
      {!isSearchMode && (
        <MusicBoardTabs
          boards={boards.boards}
          currentBoardId={boards.currentBoardId}
          view={history.view}
          playlistCount={history.playlistSongs.length}
          onSelectPlaylist={() => { history.setView('playlist'); boards.setCurrentBoardId('') }}
          onSelectBoard={(id) => { boards.handleBoardChange(id); history.setView('none') }}
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
          view={history.view}
          playlistCount={history.playlistSongs.length}
          boardCount={boards.boardSongs.length}
          currentSong={currentSong}
          isPlaying={player.isPlaying}
          onPlaySong={player.handlePlaySong}
          isFavoriteSong={history.isFavorite}
          onRemoveSong={handleRemoveSong}
          onClearPlaylist={handleClearPlaylist}
          hasMore={search.hasMore}
          loadingMore={search.loadingMore}
          onLoadMore={() => void search.loadMore()}
        />

        {/* 右侧:封面 + 歌词 */}
        <MusicLyricPanel
          currentSong={currentSong}
          isFavorite={history.isFavorite(currentSong)}
          onToggleFavorite={handleToggleFavorite}
          karaokeMode={lyric.karaokeMode}
          onToggleKaraoke={() => lyric.setKaraokeMode(!lyric.karaokeMode)}
          lyricColor={lyric.lyricColor}
          onLyricColorChange={lyric.setLyricColor}
          lyricFontSize={lyric.lyricFontSize}
          onLyricFontSizeChange={lyric.setLyricFontSize}
          lyricBg={lyric.lyricBg}
          onLyricBgChange={lyric.setLyricBg}
          lyricBgColor={lyric.lyricBgColor}
          onLyricBgColorChange={lyric.setLyricBgColor}
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
        quality={quality}
        onQualityChange={handleQualityChange}
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
