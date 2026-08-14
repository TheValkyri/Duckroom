/**
 * Kho dữ liệu Lời bài hát & LRC Đồng bộ Cộng đồng (Duckroom Community & Vietnamese Lyrics Vault)
 * Chứa các bản ghi lời bài hát & LRC chuẩn từng giây cho các ca khúc Việt Nam, Indie, Rap Việt & Hi-Res
 */

export interface PresetLyric {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  isSynced: boolean;
  syncedLyrics?: string;
  plainLyrics?: string;
  source: string;
}

export const COMMUNITY_LYRICS: PresetLyric[] = [
  {
    title: "nước",
    artist: "Obito",
    album: "Single",
    duration: 156,
    isSynced: true,
    source: "Duckroom Community (Verified)",
    syncedLyrics: `[00:14.20] Anh đã thấy em bên bờ sông, yeah
[00:17.50] Đêm khuya đã rơi theo anh vào trong
[00:21.20] Baby, em hỏi anh khi nào xong, yah
[00:25.00] Mau dang cánh tay ôm em vào lòng
[00:29.30] Baby hỏi anh khi nào xong
[00:32.80] Mỗi khi em đợi mong liệu rằng em có yêu anh thật không?
[00:37.20] Đừng dối khi anh chờ trông
[00:40.50] Bao nhiêu đêm tối anh đau quặn lòng
[00:44.40] Hát vu vơ nhạt không, bao nhiêu sương gió bao nhiêu là xong?
[00:49.00] Lạnh buốt vai khi mùa đông
[00:52.20] Quên bao câu nói... nói...
[00:55.50] Gần mà cách xa... gần mà cách xa
[01:00.00] Lang thang những xó... oh oh oh...
[01:04.20] Tối... oh oh oh...
[01:08.00] I love u star... I love u star...
[01:12.50] Lại những nước mắt cứ phai đi cùng dù chuyện muộn màng khi nắng lên ánh dương vừa tàn
[01:20.00] Lại những dấu vết khi xưa trong lòng dần mờ nhạt nhoà khi anh không thể đi cùng nàng
[01:27.50] Mơ được một làn khói cho anh xiết
[01:31.20] Vơi đi bao đắng cay của anh với em mới như hôm nào
[01:35.80] Giờ tình yêu đôi ta như hạt bông tuyết
[01:39.50] Hương thơm em mỗi đêm khiến anh ngất ngây cứ như chiêm bao
[01:44.00] Anh đã thấy em bên bờ sông, uh yeh~
[01:48.20] Đêm khuya đã rơi theo anh vào trong~~~
[01:52.00] Baby em hỏi anh khi nào xong, yehh~
[01:56.00] Mau dang cánh tay ôm em vào lòng
[02:00.50] Bấy lâu... bấy lâu... quá lâu rồi...
[02:05.00] Bấy lâu... bấy lâu... quá lâu rồi.`,
  },
  {
    title: "mây",
    artist: "Obito",
    album: "Single",
    duration: 168,
    isSynced: true,
    source: "Duckroom Community (Verified)",
    syncedLyrics: `[00:11.50] Thả vào đời hàng ngàn nỗi lo
[00:15.50] Cố nhấn anh xuống cứ liên hồi
[00:19.20] Cược một trái tim nhiều lần tan vỡ, anh điên rồi
[00:24.50] Chỉ một bước đi anh cũng suy nghĩ điều nên tồi
[00:29.20] Hai từ "chúng ta" giờ đã biến mất trong đêm rồi
[00:34.00] Nhìn lên bầu trời mây trôi lững lờ
[00:39.50] Từng ký ức xưa cứ thế vỡ đôi
[00:44.20] Tình yêu của anh trao em bấy lâu
[00:49.00] Giờ như áng mây trôi về nơi đâu
[00:54.50] Lang thang góc phố một mình anh bước
[00:59.20] Gạt giọt lệ sầu ướt đẫm hàng mi
[01:04.00] Chúc em bình yên trên con đường mới
[01:09.50] Áng mây buồn trôi mãi không quay về.`,
  },
  {
    title: "dư âm",
    artist: "Obito",
    album: "Single",
    duration: 172,
    isSynced: true,
    source: "Duckroom Community (Verified)",
    syncedLyrics: `[00:12.00] Chỉ một lời nói, xa phía xa trong đêm kia mưa lại rơi
[00:17.50] Chợt một màu tối, xa thì mưa lại rơi
[00:22.20] Có những khúc mắc em ơi, em ơi, em ơi
[00:27.00] Lại thấy nước mắt em rơi, em rơi, em rơi
[00:31.50] Chẳng thể cố lấy như xưa, như xưa, như xưa
[00:36.20] Người ở trước mắt nhưng thôi, anh thôi, em thôi
[00:41.00] Gạt làm chi vì trong đôi mắt người
[00:45.50] Anh thấy sau đấy như chuyện buồn
[00:50.00] Chịu nhiều thương đau tặng cho một bóng hình
[00:54.50] Mà cứ yêu, cứ lao điên cuồng
[00:59.00] Anh như đang lạc lối về chuyện tình buồn ngày hôm qua
[01:03.50] Thêm bao nhiêu bài hát vì nhiều giọt lệ rồi khôn ra
[01:08.00] Trên vai anh còn thấy được chặng đường đời còn bôn ba
[01:12.50] Qua đi thôi cùng mấy lần cuộc tình mình được đơm hoa
[01:17.20] Hah, hoa đã nở, em đi về, yeah, yeah
[01:22.00] Baby cứ nói anh nghe, baby cứ nói anh nghe
[01:26.50] Bao nhiêu chuyện buồn tình mặn nồng em mong ước
[01:31.00] Tình mặn nồng em mong ước, baby cứ nói anh nghe
[01:35.50] Hah, nói anh nghe, hah, yeah, nói anh nghe
[01:40.00] Yeah, hah, nói anh nghe
[01:44.50] Yeah, hah, nói anh nghe, yeah, hah, nói anh nghe.`,
  },
  {
    title: "đôi khi",
    artist: "Obito",
    album: "Single",
    duration: 149,
    isSynced: true,
    source: "Duckroom Community (Verified)",
    syncedLyrics: `[00:13.00] Ngồi trên xe anh đi ngang qua
[00:16.50] Từng ký ức đó chỉ có hai ta
[00:19.80] Áng mây buồn
[00:22.20] Ngoài bầu trời thì mưa cứ tuôn
[00:25.80] Chỉ mong sao niềm vui xung quanh người
[00:29.50] Nơi đau thương cũng chẳng hề ngó tới
[00:33.00] Vết thương trong em do một bóng hình, là anh
[00:37.50] Vì mọi thứ cũng đã xong rồi, em ơi
[00:41.20] Phố khi xưa anh đợi giờ cũng đã xong xuôi
[00:45.00] Ngắm mưa rơi bên thềm
[00:47.50] Chỉ làm lòng anh thêm nặng thêm, oh-oh
[00:51.80] Gió lất phất ngang qua, anh ngân nga đôi câu ca buồn
[00:56.50] Nước mắt cứ tuôn rơi để cho con tim anh thêm đau thôi
[01:01.00] Hỡi người, hỡi người
[01:04.20] Giờ câu nói nơi em đang xa dần
[01:07.80] Anh cũng nhớ em khi hơi ta gần
[01:11.20] Chợt nghe tiếng trong đêm đôi ba lần
[01:14.80] Chỉ là mơ nhưng sao trong tim tự dưng nhói?
[01:19.20] Đôi khi ta gặp nhau lại thấy có lỗi
[01:23.50] Đôi khi anh ngồi đây để xám hối
[01:27.20] Từng giọt sầu rơi trên bờ mi
[01:30.80] Nhìn lại ngày hai ta biệt ly
[01:34.50] Giờ chỉ còn là những ký ức nhạt nhòa...`,
  },
  {
    title: "lệ drip",
    artist: "Lý Lữ Ca",
    album: "Single",
    duration: 180,
    isSynced: true,
    source: "Duckroom Community (Verified)",
    syncedLyrics: `[00:14.00] Lệ nhỏ từng giọt trên đôi gò má
[00:18.50] Giọt lệ rơi theo từng tiếng thở dài
[00:23.20] Nhìn lại cuộc tình nay đã phôi pha
[00:27.80] Dù lòng này còn yêu mãi khôn nguôi
[00:32.50] Drip drip từng hạt mưa rơi ngoài hiên
[00:37.00] Bao muộn phiền chôn giấu trong tim
[00:41.80] Người ra đi không một lời từ biệt
[00:46.50] Để lại nỗi đau riêng mình anh biết...`,
  },
];
