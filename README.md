# Dream Japan v4: upgrade नगरी चल्ने संस्करण

यो संस्करण Firebase Authentication र Firestore बाट चल्छ। Cloud Functions, billing upgrade, functions deployment वा Node.js installation आवश्यक छैन। Firebase को उपलब्ध free quota भने लागू हुन्छ। तपाईंको live Firebase settings वा GitHub repository यस कामबाट स्वतः परिवर्तन गरिएको छैन।

## सुरुमा यी तीन काम गर्नुहोस्

1. ZIP खोल्नुहोस् र `dream-japan` folder भित्रका website files आफ्नो GitHub repository मा राख्नुहोस्।
2. यसै folder को `firestore.rules` खोल्नुहोस्। Firebase Console > Firestore Database > Rules मा पुराना rules को सट्टा पूरा नयाँ rules paste गरेर **Publish** गर्नुहोस्।
3. Website मा **Ctrl + Shift + R** गर्नुहोस्, sign out गरेर फेरि sign in गर्नुहोस्। Install गरिएको app भए बन्द गरेर फेरि खोल्नुहोस्।

**नयाँ script.js र नयाँ rules दुवै चाहिन्छ।** पुराना Functions प्रयोग गर्ने rules ले requests र results लेख्न दिँदैनन्। पुरानो script.js ले उपलब्ध नभएका Functions बोलाइरहन्छ।

## GitHub मा राख्ने फाइलहरू

```
index.html
style.css
script.js
sw.js
manifest.webmanifest
icons/icon.svg
icons/icon-192.png
icons/icon-512.png
photos/esewa.jpg
photos/your-question-images.jpg
audio/your-question-audio.mp3
```

`photos/` र `audio/` मा भएका आफ्ना पुराना media नहटाउनुहोस्। यस ZIP मा तपाईंको वास्तविक eSewa QR र question media समावेश छैनन्। आफ्नै QR `photos/esewa.jpg` मा राख्नुहोस्।

Website files repository root मा राख्नुहोस्, `dream-japan` नामको थप subfolder भित्र होइन, यदि हालको URL `https://deepakrajpant.github.io/testapi/` नै राख्ने हो भने।

`firestore.rules`, `firebase.json`, README, CHANGES र tests reference का लागि हुन्। Browser बाट website चलाउन तिनलाई execute गर्नु पर्दैन। No-upgrade ZIP मा `functions/` folder छैन।

## Admin सेटअप

Verified email `deepakrajpant978@gmail.com` बाट sign in गर्नुहोस्। Email verification पूरा गरेपछि फेरि sign in गर्नुहोस्। Profile > Admin Dashboard > Settings खोल्नुहोस्।

* वास्तविक eSewa number राख्नुहोस्। अघिल्लो निर्देशनमा number नदिइएकाले default खाली छ।
* QR path `photos/esewa.jpg` राख्नुहोस्।
* WhatsApp number जाँच्नुहोस्। तपाईंले दिएको `97766157755` कायम छ; पूरा सही number हो भन्ने सुनिश्चित गर्नुहोस्।
* उपलब्ध plan छैन भने Add Plan बाट name, numeric price, whole number of days र benefits राख्नुहोस्।
* पुरानो plan को price वा days text मा stored छ भने Settings मा Edit गरेर Save गर्नुहोस्।
* Install suggestion देखाउने/नदेखाउने छान्नुहोस्।

## Premium request र approval

Student ले plan छानेपछि QR, eSewa number र आफ्नो email copy गर्न मिल्छ। Payment remark मा email राखेर payment गरेपछि transaction reference लेखी **I have completed payment** थिच्छ।

Request अब Firestore को `accessRequests/{studentUid}` मा सीधै save हुन्छ। Pending request हुँदा नयाँ request जाँदैन। पुरानो version बाट आएको pending request पनि जाँचिन्छ। Approved/rejected request पछि अर्को payment request पठाउन मिल्छ। एउटै UID को नयाँ request document मा पछिल्लो request रहन्छ; पुराना payment attempts को पूर्ण ledger यस संस्करणले बनाउँदैन।

Admin > Requests मा email, plan, days, amount र transaction reference देखिन्छ। भुक्तानी आफैँ जाँचेर Approve गर्नुहोस्। Approval transaction ले premium र request status सँगै update गर्छ। दोहोर्‍याएर approve गर्न दिँदैन। In-app request count र नयाँ pending request को toast app खुला हुँदा देखिन्छ। Background push, SMS वा email पठाउँदैन।

WhatsApp बटनले विद्यार्थीलाई prefilled draft खोल्छ। विद्यार्थीले आफैँ review गरेर Send गर्नुपर्छ। Website ले payment verify वा message स्वतः send गर्दैन।

Admin > Students बाट 1 देखि 3650 दिनसम्म custom duration, premium removal, notes, search/filter, block/unblock र browser reset उपलब्ध छन्। Active plan extend गर्दा बाँकी expiry पछि नयाँ days थपिन्छन्।

## Exam र marks

Student को status active र premium expiry बाँकी हुँदा मात्र Firestore rules ले question collection पढ्न दिन्छन्। Expired, blocked वा unpaid student लाई सामान्य website flow मा test/practice खुल्दैन। Verified admin लाई preview/test गर्न मिल्छ।

Question document अघिकै हो:

`jftoctnovset/QORwII8D7qLZ7wuCDW36`

यस document मा `questions` array राख्नुहोस्। पुरानो 11-column format:

```
[setNumber, sectionKey, question, passage, image, audio, answer, A, B, C, D]
```

उदाहरण:

```json
[1,"lc","正しい答えを選んでください。","NA","NA","audio/s1q1.mp3","B","月曜日","火曜日","水曜日","NA"]
```

Object format पनि चल्छ। Sections `sv`, `ce`, `lc`, `rc` र set numbers 1 देखि 6 हुन्। Optional `NA` values screen मा देखिँदैनन्। फरक 12-column spreadsheet schema प्रयोग गर्नुअघि माथिको format मा बदल्नुहोस्।

Section weights 3, 4, 6 र 7 कायम छन्। हरेक set अलग scale हुन्छ:

```
originalFullMarks = sum(questionCountInSection * sectionWeight)
newQuestionMarks = originalQuestionMarks * 250 / originalFullMarks
finalScore = earnedOriginalMarks * 250 / originalFullMarks
```

Maximum 250, mock pass target 200, score दुई decimal सम्म। यो mock scoring हो, official JFT score algorithm होइन। Question marks test/practice मा देखिँदैनन्।

Media पूरा set को लागि timer सुरु हुनुअघि preload हुन्छ। Failed download मा cancel/retry/continue विकल्प छ। Image को white 16:9 slot र fixed bottom Previous/Next ले layout स्थिर राख्छन्। Audio मा play/pause, elapsed/total time र progress छ। Slow connection वा missing file तुरुन्त उपलब्ध हुन्छ भन्ने ग्यारेन्टी हुँदैन।

Bookmarks, set/section question filters, media preview, full filtered preview, reorder, bulk delete, import/export र centered section confirmation कायम छन्।

## यस निःशुल्क architecture का सुरक्षा सीमा

**Browser binding:** Payment request गर्ने browser को random ID approval मा राखिन्छ। अर्को browser सामान्य website flow बाट खोल्दा रोक्छ। Manual grant मा पहिले paid access खोल्ने browser bind हुन्छ। Admin ले Reset Device गर्न सक्छ। Browser data मेटाए वा browser बदले reset आवश्यक पर्न सक्छ।

यो hardware lock वा cryptographic restriction होइन। Firestore rules लाई browser identity प्रमाणित गर्ने trusted credential उपलब्ध छैन। Premium user ले आफ्नै code बदल्दा वा browser credential copy गर्दा UI restriction bypass गर्न सक्छ। Rules ले active premium enforce गर्छन्, physical one-device restriction enforce गर्दैनन्। यो सीमा लुकाइएको छैन।

**Leaderboard:** Marks browser मा गणना हुन्छन्। Rules ले fields/ranges र result reference जाँच गर्छन्, तर score question answers सँग trusted server मा verify हुँदैन। जानाजानी code बदल्ने विद्यार्थीले score falsify गर्न सक्छ। त्यसैले UI मा browser-reported practice score भनेर लेखिएको छ। Leaderboard मा display name, score, streak, attempt reference र timestamp मात्र राखिन्छ; email/payment details हुँदैन।

**Question/media privacy:** Premium user को browser ले question/answer data प्राप्त गर्छ। Screenshot, copy वा downloaded questions रोक्न सकिँदैन। Public GitHub media URLs सार्वजनिक नै रहन्छन्। Watermark ownership reminder हो, DRM होइन।

## Installed app

PWA files र icons समावेश छन्। Supported HTTPS browser बाट Install/Add to Home Screen गर्न मिल्छ। Installed app standalone खुल्दा सामान्य browser address bar हुँदैन। साधारण browser tab मा address bar हटाउन website ले सक्दैन।

Admin toggle app को install suggestion का लागि हो। Browser को आफ्नै install menu नियन्त्रण गर्दैन। iPhone/iPad मा Safari > Share > Add to Home Screen प्रयोग गर्नुहोस्। Login, premium checking र saving का लागि connection चाहिन्छ।

## Troubleshooting

* अझै `functions/internal` आउँछ: पुरानो script load भएको छ। नयाँ `index.html`, `script.js` र `sw.js` राखेर hard refresh/sign out/sign in गर्नुहोस्। नयाँ script मा Cloud Functions import/call नै छैन।
* `permission-denied`: यस package को नयाँ `firestore.rules` पूरा Publish भएको छ कि जाँच्नुहोस्। Rules सबैका लागि open नगर्नुहोस्।
* Admin dashboard नखुले: माथिको exact verified admin email र नयाँ sign-in session जाँच्नुहोस्।
* Premium छ तर access denied: admin बाट plan पुनः grant गर्नुहोस्, ताकि expiry सही Firestore Timestamp रूपमा save होस्। अर्को browser message भए Reset Device गर्नुहोस्।
* Pending request देखिँदैन: Request button पछिको toast पढ्नुहोस्; Firebase Firestore > accessRequests मा आफ्नै UID document pending छ कि जाँच्नुहोस्।
* Request form खुल्दैन: pending request छ कि हेर्नुहोस्। Plan days/price numeric छन् कि admin Settings मा save गरेर हेर्नुहोस्।
* Image/audio नआए: case-sensitive filename/path, photos/audio folders र public media URL जाँच्नुहोस्।

## परीक्षण

१२ mocked Firestore transaction tests पास छन्: unpaid access, browser binding, new/legacy pending request guard, closed request resubmission, admin authorization, approval, grant/revoke/reset, direct exam loading, atomic result/leaderboard saving, retries र invalid scores।

यदि Node.js छ भने optional परीक्षण:

```
node --test tests/*.test.cjs
```

Website चलाउन Node.js चाहिँदैन। Syntax र local browser exam flow जाँचिएको छ। यी tests ले वास्तविक Firestore Rules Emulator वा तपाईंको live Firebase deployment को पूर्ण परीक्षण प्रतिस्थापन गर्दैनन्। Production मा नयाँ rules Publish गरेपछि disposable student account बाट request > approve > start exam > result save एक पटक जाँच्नुहोस्।

## स्रोत

https://firebase.google.com/docs/firestore/manage-data/transactions
https://firebase.google.com/docs/firestore/security/rules-conditions
