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
    title: "BOUNCE",
    artist: "Hazel",
    album: "BẢY",
    duration: 229,
    isSynced: true,
    source: "Duckroom Community (YouTube / Genius Verified)",
    syncedLyrics: `[00:00.00] Then again, hell, as you call it
[00:03.50] Has always been the true heart of human religion
[00:07.50] You can curb the worst of your thoughts only through collected fear and hatred of another world
[00:13.50] My world
[00:16.00] Bounce, we go
[00:18.20] Địa ngục huyên náo điên đảo vẫn gọi tên tao, hư vô
[00:22.50] Lộn ngược một vòng tam giới từ thấp lên cao như nhau
[00:26.80] Tự hỏi những lời khuyên bảo ở trong chiêm bao, đi đâu?
[00:31.20] Bầu trời sao, mưa ngâu
[00:33.50] I said, "bounce", we go
[00:35.80] Her head went straight back down to suck around, the souls
[00:40.20] Để năng lượng này tỏa ra họ cảm nhận tao, khi đau (Ah)
[00:44.50] Liệu em còn ở cạnh bên, but I said, "nah she won't, nah she won't"
[00:48.50] Pick a mic, a side
[00:51.00] Chọn ai vai đau mỏi (Ai?)
[00:53.50] Để xem giữa bầu trời đêm ai dành lời khen cho ngôi sao chổi
[00:58.00] Ngước mắt nhìn lên thật cao thấy những giọt lệ không thể lau nổi
[01:02.50] Đồng hồ thì không biết nói nhưng thời gian sẽ trả lời câu hỏi (Hỏi)
[01:07.00] Ghi và chép giá trị cũ đổi giá trị mới ngày hôm qua
[01:11.20] Suy và xét theo hành trình khám phá dị giới và tâm ma (Ah)
[01:15.50] Giây phút bạc nhược trước khung thành thì sút toàn trượt và văng xa
[01:19.80] Đến lúc làm được có lẽ là phúc lạc dược được thông qua (Qua)
[01:24.00] Nếu muốn viết sạch chắc ngòi bút phải thay bằng huyết mạch
[01:27.50] Đỏ trên nền trắng giống như hoa phượng nở trên tuyết lạnh
[01:30.50] Trong lòng bão tố nhưng mà phần tâm can là thiết thạch (Yeah)
[01:32.00] Muốn tìm hạt vàng lòng phải không bi quan
[01:34.50] Phần tâm đã tĩnh ở trong nguy nan
[01:37.00] Tận hưởng cơn giông đi ngang (Ngang)
[01:39.50] Bao nhiêu nghi can lại chỉ mong phi tang
[01:42.00] Cái ngày mà tao nằm xuống chúng mày sẽ thấy cửu long di quan
[01:45.00] Bounce, we go
[01:47.20] Địa ngục huyên náo điên đảo vẫn gọi tên tao, hư vô
[01:51.50] Lộn ngược một vòng tam giới từ thấp lên cao như nhau
[01:55.80] Tự hỏi những lời khuyên bảo ở trong chiêm bao (What?), đi đâu? (Where?)
[02:00.20] Bầu trời sao, mưa ngâu
[02:02.50] I said, "bounce", we go
[02:04.80] Her head went straight back down to suck around, the souls
[02:09.20] Để năng lượng này tỏa ra họ cảm nhận tao, khi đau
[02:13.50] Liệu em còn ở cạnh bên, but I said, "nah she won't, nah she won't"
[02:17.50] Nói tao nghe mày thấy gì bên ngoài xa xăm
[02:20.50] Đôi mắt mày đang nhầm lẫn làm gì có vị thiên sứ nào da ngăm
[02:24.50] Chỉ có kẻ trong cơn điên mới chọn vong xuyên làm nơi thả hoa đăng
[02:29.00] Còn những con chiên lạc lối lại về ở dưới đôi cánh của Satan
[02:33.50] Họ bảo là, biến kẻ thù thành bạn?
[02:35.50] Nah, tao biến kẻ thù thành đoạn
[02:37.50] Chấp nhận nếu phần người lành lặn thì cũng phải khiến phần hồn thành loạn
[02:42.00] Tất cả những kẻ nào mạnh dạn sẽ được đưa tiễn về miền cực lạc
[02:46.50] Đem mọi thứ đặt về cực hạn, bàn tay chạm đến cả vạn mảnh đạn
[02:50.50] Get 'em
[02:52.00] Nói tao nghe mày là phe quỷ hay phe thần (Yeah)
[02:55.00] I'm the he before the hell and heaven (Yeah)
[02:58.00] Vậy độc nhất sẽ là toxic hay venom (Yeah)
[03:00.80] Lemme talk to Satan
[03:02.80] Hai năm mươi, ba năm mươi rồi bốn năm mươi
[03:05.50] Nhìn những con số tăng lên lòng tham vô đáy chúng muốn nhân đôi (Uh-huh)
[03:09.80] Ở giữa cái chốn ăn chơi có mấy thằng khốn đang muốn ăn tươi
[03:13.80] Chén thánh đã uống xong xuôi chỉ còn long đen đổ xuống chân thôi
[03:18.00] Đừng nói ân huệ, nếu như chưa từng có đủ công lao
[03:21.80] Những sự thật mày phơi ra tao coi như món hàng thủ công cao
[03:25.50] Nếu nhận quân tử hơn tao thì phải đảm bảo quân tử hơn tao
[03:29.50] Nếu đã cầm ỷ thiên kiếm thì chỉ tuyên chiến với chủ long đao
[03:33.50] Bounce, we go
[03:35.50] Địa ngục huyên náo điên đảo vẫn gọi tên tao, hư vô
[03:39.50] Lộn ngược một vòng tam giới từ thấp lên cao như nhau
[03:43.50] Tự hỏi những lời khuyên bảo ở trong chiêm bao, đi đâu?
[03:46.00] I said, "bounce", we go!`,
  },
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
    duration: 172,
    isSynced: true,
    source: "Duckroom Community (Genius Verified)",
    syncedLyrics: `[00:11.50] Thả vào đời hàng ngàn nỗi lo, cố nhấn anh xuống cứ liên hồi
[00:16.80] Cược một trái tim nhiều lần tan vỡ, anh điên rồi
[00:21.50] Chỉ một bước đi anh cũng suy nghĩ liệu nên tội
[00:26.50] Hai từ "chúng ta" giờ đã biến mất trong đêm rồi
[00:31.00] (Huh-uh-uh-huh-uh-uh-uh-uh)
[00:34.50] Nơi bao dấu yêu khi xưa liệu ta còn có thể?
[00:39.50] (Huh-uh-uh-huh-uh-uh-uh-uh)
[00:43.00] Anh nghe tiếng em đâu đây khi đứng trên lối về
[00:48.00] Phút chốc bầu trời còn trong xanh
[00:50.50] Cơn gió đùa cùng bồ công anh rồi mãi xa
[00:53.50] Em thấy điều gì ở trong anh?
[00:55.80] Bao tiếng lòng cùng sự mong manh đang xé ra
[00:58.20] Rồi hóa tro tàn, đống lơ là
[01:00.80] Theo bao dấu chân anh đi về phía không ngóng chờ
[01:03.50] Còn những mơ màng, lướt trên đàn
[01:06.00] Vang lên tiếng ca đau thương, làm sao đây hả em ơi?
[01:08.80] Tối ta chùng nhau suốt, cùng nhau uống nhấp môi ly và cùng bao thuốc
[01:13.50] Chuyện mình đâu muốn áng mây đen đùng đùng lao xuống
[01:17.00] Mình lại mau cuốn khói bay nghi ngờ rồi đau đớn, làm mình mau lớn hơn
[01:21.80] (Huh-uh-uh-huh-uh-uh-uh-uh)
[01:25.50] Nơi bao dấu yêu khi xưa liệu ta còn có thể?
[01:30.00] (Huh-uh-uh-huh-uh-uh-uh-uh)
[01:33.80] Anh nghe tiếng em đâu đây khi đứng trên lối về
[01:38.50] Nhiều lời buông ra về anh cho dù đúng hay là sai, that's the way I feeling cảm xúc
[01:43.80] Em đi khuất xa nơi đây, đi khuất xa nơi đây
[01:46.50] Trappin' vài câu xong lại quên đi ngày mai, I'm about to stuck in the loop
[01:51.50] Những cơn đau đớn đang khơi dậy
[01:54.00] Đôi chân cứ lê đi anh tìm những kỷ niệm giờ còn lại là xác xơ giữa mênh mông trời
[01:59.20] Lặng thầm về một cuộc tình dài
[02:02.00] Lại những khi ấy anh làm sai, và thật sự talk you all those lies
[02:07.00] Khiến cho em mệt nhoài, anh tự vụt tắt đi đôi bờ vai
[02:11.80] Nhiều lời em nhắn lúc đó anh cũng đau bao nhiêu lần
[02:15.00] Từng cảm xúc anh cứ như là xa hay gần
[02:17.80] Rằng tụi mình sẽ dừng lại vì đớn đau bao lần
[02:20.50] Chẳng còn gì ngoài một mình và trái tim chai sần
[02:23.50] Giờ mong ước đấy cũng trôi theo thời gian
[02:26.50] Tình yêu đang dở dang, đành thôi cũng lỡ làng
[02:29.80] Lại những tình hóa nhưng muộn màng, lụi dần đến khi tro tàn, ah-ah-ah
[02:35.00] Chạm vào nỗi nhớ, nơi những yêu thương muốn anh bên em giờ quá xa sau nơi ẩn mây
[02:41.50] Từng đêm hiu hắt, anh nói với anh "Baby, chuyện đâu ý gì"
[02:46.00] Nói thế thôi anh cũng chẳng nghĩ gì...`,
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
  {
    title: "Slippery",
    artist: "RPT MCK",
    album: "HVL",
    duration: 216,
    isSynced: true,
    source: "Duckroom Community (Genius / Studio Verified)",
    syncedLyrics: `[00:00.00] Slippery - RPT MCK ft. Tùng Dương
[00:03.50] <00:03.50> Chúng <00:03.80> mày <00:04.10> thì <00:04.30> biết <00:04.55> cái <00:04.80> đéo <00:05.10> gì <00:05.40> về <00:05.70> tao
[00:06.20] <00:06.20> Rockstar <00:06.85> made, <00:07.40> tao <00:07.70> đéo <00:08.00> ngại <00:08.35> thằng <00:08.70> nào
[00:09.10] <00:09.10> Da <00:09.35> vàng <00:09.65> trẻ, <00:10.20> tao <00:10.50> nhét <00:10.85> tiền <00:11.20> vào <00:11.55> bao
[00:12.40] <00:12.40> Cho <00:12.65> đến <00:12.90> khi <00:13.15> tao <00:13.40> chết, <00:13.90> tao <00:14.20> vẫn <00:14.50> lowkey <00:14.95> flex
[00:15.50] <00:15.50> Đừng <00:15.80> nói <00:16.10> vấn <00:16.35> đề <00:16.60> khác, <00:17.00> bởi <00:17.25> vì <00:17.50> tao <00:17.75> không <00:18.00> thích
[00:18.20] <00:18.20> Tao <00:18.60> không <00:19.10> thích
[00:20.50] <00:20.50> Tao <00:21.00> không— <00:21.50> Tao <00:21.90> không <00:22.30> thích
[00:23.20] <00:23.20> Tao <00:23.50> không <00:23.80> thích <00:24.15> mấy <00:24.45> thằng <00:24.75> hai <00:25.05> mặt <00:25.35> đâu, <00:25.90> bitch
[00:26.50] <00:26.50> Tao <00:26.85> sẽ <00:27.20> không <00:27.55> gặp <00:27.90> đâu, <00:28.60> bitch
[00:29.80] <00:29.80> Trái <00:30.15> tim <00:30.50> chrome <00:31.10> outfit
[00:32.20] <00:32.20> Trái <00:32.55> tim <00:32.90> chrome <00:33.50> outfit, <00:34.20> bitch
[00:35.50] <00:35.50> Yeah, <00:36.00> tao <00:36.35> bước <00:36.70> đi <00:37.05> vào <00:37.40> pit, <00:37.90> yeah
[00:38.80] <00:38.80> Yeah, <00:39.30> tao <00:39.65> bước <00:40.00> đi <00:40.35> vào <00:40.70> pit
[00:41.50] <00:41.50> Mấy <00:41.90> cô <00:42.30> em <00:42.70> trông <00:43.10> lit
[00:43.80] <00:43.80> Mấy <00:44.25> quả <00:44.70> cảnh <00:45.15> sâu <00:45.60> tít
[00:46.50] <00:46.50> Tao <00:46.90> đang <00:47.30> thích <00:47.65> nghi, <00:48.10> nó <00:48.45> quá <00:48.80> slippery, <00:49.60> cả <00:50.00> người <00:50.40> tao <00:50.80> trơn <00:51.15> trượt
[00:51.50] <00:51.50> Yeah, <00:52.20> tao <00:52.60> thích <00:53.00> bay <00:53.40> dưới <00:53.80> những <00:54.20> đám <00:54.60> mây <00:55.10> đéo <00:55.50> thể <00:55.90> nào <00:56.30> cao <00:56.70> hơn <00:57.10> được
[00:57.00] <00:57.00> Mày <00:57.40> muốn <00:57.80> respect <00:58.30> của <00:58.70> tao? <00:59.20> Muốn <00:59.60> trust <01:00.00> của <01:00.40> tao?
[01:00.80] <01:00.80> Thử <01:01.20> dành <01:01.60> lấy <01:02.00> đi <01:02.40> bố <01:02.80> mày <01:03.20> xem <01:03.60> nào
[01:04.00] <01:04.00> N0L4B3L <01:04.70> là <01:05.10> công <01:05.50> ty <01:05.90> riêng, <01:06.40> mấy <01:06.80> thằng <01:07.20> ngoài <01:07.60> kia <01:08.00> đừng <01:08.40> cố <01:08.80> mà <01:09.00> xen <01:09.15> vào
[01:09.20] <01:09.20> Bởi <01:09.60> vì <01:10.00> tao <01:10.40> không <01:10.80> thích <01:11.20> mấy <01:11.60> thằng <01:12.00> hai <01:12.30> mặt <01:12.60> đâu, <01:12.75> bitch
[01:12.80] <01:12.80> Tao <01:13.20> sẽ <01:13.60> không <01:14.00> gặp <01:14.40> đâu, <01:15.20> bitch
[01:15.80] <01:15.80> Trái <01:16.20> tim <01:16.60> chrome <01:17.20> outfit
[01:18.50] <01:18.50> Trái <01:18.90> tim <01:19.30> chrome <01:19.90> outfit, <01:20.80> bitch
[01:21.80] <01:21.80> Yeah, <01:22.30> tao <01:22.65> bước <01:23.00> đi <01:23.35> vào <01:23.70> pit
[01:24.80] <01:24.80> Yeah, <01:25.30> tao <01:25.65> bước <01:26.00> đi <01:26.35> vào <01:26.70> pit
[01:27.50] <01:27.50> Mấy <01:27.90> cô <01:28.30> em <01:28.70> trông <01:29.10> lit
[01:29.80] <01:29.80> Mấy <01:30.25> quả <01:30.70> cảnh <01:31.15> sâu <01:31.60> tít
[01:32.50] <01:32.50> Tao <01:32.90> không <01:33.30> thích <01:33.70> mấy <01:34.10> thằng <01:34.50> hai <01:34.80> mặt <01:35.10> đâu, <01:35.40> bitch
[01:35.80] <01:35.80> Tao <01:36.20> sẽ <01:36.60> không <01:37.00> gặp <01:37.40> đâu, <01:38.20> bitch
[01:38.80] <01:38.80> Trái <01:39.20> tim <01:39.60> chrome <01:40.20> outfit
[01:41.50] <01:41.50> Trái <01:41.90> tim <01:42.30> chrome <01:42.90> outfit, <01:43.80> bitch
[01:44.80] <01:44.80> Yeah, <01:45.30> tao <01:45.65> bước <01:46.00> đi <01:46.35> vào <01:46.70> pit
[01:47.80] <01:47.80> Yeah, <01:48.30> tao <01:48.65> bước <01:49.00> đi <01:49.35> vào <01:49.70> pit
[01:50.50] <01:50.50> Mấy <01:50.90> cô <01:51.30> em <01:51.70> trông <01:52.10> lit
[01:52.80] <01:52.80> Mấy <01:53.30> quả <01:53.80> cảnh <01:54.30> sâu...
[01:56.50] <01:56.50> Mẹ <01:57.20> ơi, <01:58.20> dưới <01:59.00> đất <01:59.80> trời <02:00.60> con <02:01.40> cúi <02:02.20> lạy
[02:04.00] <02:04.00> Trên <02:05.00> đỉnh <02:06.00> núi <02:07.00> cao <02:08.00> chơi <02:09.00> vơi <02:10.00> quá
[02:11.50] <02:11.50> Trong <02:12.80> vô <02:14.00> định, <02:15.50> con <02:16.80> tìm <02:18.00> về <02:19.20> nơi <02:20.40> bắt <02:21.00> đầu...
[02:22.00] <02:22.00> Thích <02:22.50> như <02:23.00> nào, <02:23.80> thích <02:24.30> như <02:24.80> nào
[02:25.50] <02:25.50> Thích <02:26.00> như <02:26.50> nào, <02:27.20> như <02:27.80> nào
[02:28.50] <02:28.50> Cách <02:29.00> số <02:29.40> phận <02:29.80> lôi <02:30.20> tao <02:30.60> vào <02:31.00> rap <02:31.40> game <02:31.70> này
[02:32.00] <02:32.00> Tao <02:32.40> bước <02:32.80> ra <02:33.20> đằng <02:33.60> trước, <02:34.20> huh-huh
[02:35.50] <02:35.50> Tham <02:36.00> vọng <02:36.50> lan <02:37.00> khắp <02:37.50> phòng, <02:38.20> uh-huh
[02:39.00] <02:39.00> Từng <02:39.60> đường <02:40.20> nét <02:40.80> chroma, <02:41.80> chroma
[02:43.00] <02:43.00> Từng <02:43.60> đường <02:44.20> nét <02:44.80> chroma, <02:45.80> chroma
[02:48.00] <02:48.00> Tao <02:48.40> không <02:48.80> thích <02:49.20> mấy <02:49.60> thằng <02:50.00> hai <02:50.30> mặt <02:50.60> đâu, <02:50.90> bitch
[02:51.50] <02:51.50> Tao <02:51.90> sẽ <02:52.30> không <02:52.70> gặp <02:53.10> đâu, <02:53.80> bitch
[02:54.80] <02:54.80> Trái <02:55.20> tim <02:55.60> chrome <02:56.20> outfit, <02:57.00> chrome <02:57.60> outfit
[02:58.50] <02:58.50> Yeah, <02:59.00> tao <02:59.35> bước <02:59.70> đi <03:00.05> vào <03:00.40> pit
[03:01.80] <03:01.80> Yeah, <03:02.30> tao <03:02.65> bước <03:03.00> đi <03:03.35> vào <03:03.70> pit
[03:05.00] <03:05.00> Mấy <03:05.40> cô <03:05.80> em <03:06.20> trông <03:06.60> lit...`,
  },
];
