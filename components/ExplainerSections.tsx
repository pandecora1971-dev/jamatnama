import PencilDrawing from "./PencilDrawing";

export function HowItHelps() {
  return (
    <section
      className="story-section story-purpose"
      id="why"
      aria-labelledby="why-title"
    >
      <div className="jwr-shell">
        <div className="story-heading story-reveal">
          <div>
            <span className="story-eyebrow">কেন জামাতনামা</span>
            <h2 id="why-title">
              আলাদা ঘটনা।
              <br />
              <span>একসঙ্গে স্পষ্ট চিত্র।</span>
            </h2>
          </div>
          <p>
            ধর্মের দোহাই দিয়ে বৈষম্য বা হয়রানি করা হলে তার সময়, স্থান ও প্রমাণ
            নথিবদ্ধ করা জরুরি। জামাতনামায় পর্যালোচনা হয় নির্দিষ্ট আচরণ,
            ঘটনার প্রেক্ষাপট ও প্রমাণের ভিত্তিতে। সব বিশ্বাসের মানুষের
            সমান মর্যাদা ও অধিকার আছে।
          </p>
        </div>
        <div className="story-benefits">
          {[
            {
              kind: "record" as const,
              number: "০১",
              title: "ঘটনাটি নথিতে থাকুক",
              text: "কী ঘটেছে, কোথায়, কখন—বিবরণ ও প্রমাণ একসঙ্গে জমা দিন। গোপন ট্র্যাকিং কোড দিয়ে পরে নিজের রিপোর্টের অবস্থা দেখুন।",
            },
            {
              kind: "place" as const,
              number: "০২",
              title: "নিজের এলাকার চিত্র জানুন",
              text: "মানচিত্র ও ফিল্টার দিয়ে এলাকার প্রকাশিত অভিযোগ খুঁজুন। একই জায়গায় কী ধরনের অভিযোগ আসছে, তা পাশাপাশি দেখুন।",
            },
            {
              kind: "voices" as const,
              number: "০৩",
              title: "আলোচনায় তথ্য থাকুক",
              text: "পর্যালোচনার পর প্রকাশিত বিবরণ পড়ুন, ঘটনার প্রেক্ষাপট বুঝুন। পাঠকের সমর্থন অভিযোগে মনোযোগ আনে; সত্যতার প্রমাণ হয় না।",
            },
          ].map((item) => (
            <article className="story-benefit story-reveal" key={item.number}>
              <div className="story-benefit-art">
                <span>{item.number}</span>
                <PencilDrawing kind={item.kind} />
              </div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
        <a className="story-text-link" href="#prepare">
          প্রথম রিপোর্টের আগে যা জানা ভালো ↓
        </a>
      </div>
    </section>
  );
}

export function ReportGuide({ onReport }: { onReport: () => void }) {
  return (
    <section
      className="story-section story-guide"
      id="prepare"
      aria-labelledby="prepare-title"
    >
      <div className="jwr-shell">
        <div className="story-guide-layout">
          <div className="story-guide-copy story-reveal">
            <span className="story-eyebrow">লেখার আগে একটু গুছিয়ে নিন</span>
            <h2 id="prepare-title">
              একটি ভালো রিপোর্ট
              <br />
              শুরু হয় <span>স্পষ্ট তথ্য দিয়ে।</span>
            </h2>
            <p>
              লম্বা লেখা জরুরি নয়। যা জানেন, নির্দিষ্ট করে লিখুন। নিজে দেখা ঘটনা
              ও অন্যের কাছে শোনা তথ্য আলাদা করে উল্লেখ করুন।
            </p>
            <PencilDrawing kind="prepare" />
            <button className="jwr-button" onClick={onReport}>
              তথ্য প্রস্তুত? রিপোর্ট করুন →
            </button>
          </div>
          <div className="story-guide-details">
            <ol className="story-checklist">
              {[
                [
                  "সময় ও স্থান",
                  "ঘটনার তারিখ, বিভাগ, জেলা ও উপজেলা/থানা নির্বাচন করুন। বর্ণনায় প্রয়োজনীয় জায়গার বিবরণ দিন।",
                ],
                [
                  "কী ঘটেছে, কার সংশ্লিষ্টতা",
                  "ঘটনাটি ধারাবাহিকভাবে লিখুন। অভিযুক্তের নাম জানা থাকলে আলাদা ঘরে দিন; পদবি ও দলীয় সংশ্লিষ্টতার ভিত্তি উল্লেখ করুন।",
                ],
                [
                  "প্রাসঙ্গিক প্রমাণ",
                  "ছবি, PDF, অডিও বা ভিডিও দিন; ফাইলের সংখ্যা ও আকারের সীমা ফর্মে দেখানো হয়। সর্বোচ্চ ৫টি সংবাদলিংকও দিতে পারেন। সংযুক্ত ফাইল ও লিংক শুধু পর্যালোচক দেখতে পারবেন।",
                ],
                [
                  "নিজের পরিচয় বাদ দিন",
                  "নিজের ও ভুক্তভোগীর অপ্রয়োজনীয় নাম, ফোন, ঠিকানা বা পরিচয় শনাক্ত করার তথ্য লেখা ও ফাইল থেকে সরিয়ে নিন।",
                ],
              ].map(([title, text], i) => (
                <li className="story-reveal" key={title}>
                  <span className="story-step-number">
                    {["০১", "০২", "০৩", "০৪"][i]}
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <aside
              className="story-example story-reveal"
              aria-label="কাল্পনিক রিপোর্টের উদাহরণ"
            >
              <span className="story-eyebrow">
                লেখার ধরন · সম্পূর্ণ কাল্পনিক উদাহরণ
              </span>
              <h3>ঘটনা লিখুন, অনুমান নয়।</h3>
              <p>
                “২০ অক্টোবর বিকেল ৪টায় সাভারের একটি দোকানে দুজন ব্যক্তি ৫,০০০
                টাকা দাবি করেন। তাঁদের একজন নিজেকে স্থানীয় দলীয় কর্মী পরিচয় দেন।
                ঘটনাস্থলের একটি ছবি সংযুক্ত করেছি।”
              </p>
              <small>
                এটি শুধু কীভাবে লিখবেন তার নমুনা; কোনো বাস্তব অভিযোগ নয়।
              </small>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReportJourney({ onTrack }: { onTrack: () => void }) {
  return (
    <section
      className="story-section story-journey"
      id="process"
      aria-labelledby="process-title"
    >
      <div className="jwr-shell">
        <div className="story-heading story-reveal">
          <div>
            <span className="story-eyebrow">জমা থেকে প্রকাশ</span>
            <h2 id="process-title">
              রিপোর্টের পরের
              <br />
              <span>ধাপগুলো জানুন।</span>
            </h2>
          </div>
          <p>
            জমা দিলেই অভিযোগ প্রকাশিত হয় না। প্রথমে পর্যালোচনা হয়। আপনার গোপন
            কোড দিয়ে অবস্থা ও পর্যালোচকের মন্তব্য দেখা যায়।
          </p>
        </div>
        <ol className="story-timeline">
          {[
            [
              "০১",
              "জমা ও গোপন কোড",
              "ফর্ম জমা হলে একটি ট্র্যাকিং কোড পাবেন। সংরক্ষণ করুন—রিপোর্টকারীর পরিচয় রাখা হয় না বলে হারানো কোড উদ্ধার করা যায় না।",
            ],
            [
              "০২",
              "তথ্য পর্যালোচনা",
              "অনুমোদিত পর্যালোচক অভিযোগের বিবরণ, প্রমাণ ও অপ্রয়োজনীয় ব্যক্তিগত পরিচয় পরীক্ষা করেন। এই সময়ে রিপোর্ট প্রকাশ্যে দেখা যায় না।",
            ],
            [
              "০৩",
              "প্রকাশের সিদ্ধান্ত",
              "পর্যালোচনার পর রিপোর্ট প্রকাশ করা হয় অথবা প্রকাশ করা হয় না। কোড দিয়ে সিদ্ধান্ত ও পর্যালোচকের মন্তব্য দেখুন।",
            ],
            [
              "০৪",
              "লাইভ তালিকায় আপডেট",
              "প্রকাশের অনুমোদন পেলে অভিযোগ তালিকা, মানচিত্র ও পরিসংখ্যানে যুক্ত হয়। প্রকাশিত অভিযোগ মানেই প্রমাণিত অপরাধ নয়।",
            ],
          ].map(([n, title, text]) => (
            <li className="story-reveal" key={n}>
              <span className="story-step-number">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <div className="story-tracking story-reveal">
          <PencilDrawing kind="track" />
          <div>
            <h3>আগে রিপোর্ট করেছেন?</h3>
            <p>নতুন করে জমা না দিয়ে গোপন ট্র্যাকিং কোড দিয়ে অগ্রগতি দেখুন।</p>
          </div>
          <button className="jwr-outline-button" onClick={onTrack}>
            রিপোর্টের অবস্থা দেখুন →
          </button>
        </div>
      </div>
    </section>
  );
}

export function PrivacyExplainer({ onPrivacy }: { onPrivacy: () => void }) {
  return (
    <section
      className="story-section story-privacy"
      id="privacy"
      aria-labelledby="privacy-title"
    >
      <div className="jwr-shell story-privacy-layout">
        <div className="story-privacy-art story-reveal">
          <PencilDrawing kind="privacy" />
          <span>ঘটনার তথ্য দিন। নিজের পরিচয় নয়।</span>
        </div>
        <div className="story-reveal">
          <span className="story-eyebrow">গোপনীয়তা বুঝে রিপোর্ট করুন</span>
          <h2 id="privacy-title">
            আপনার কথাটি জরুরি।
            <br />
            <span>পরিচয় দেওয়া জরুরি নয়।</span>
          </h2>
          <p className="story-intro">
            রিপোর্ট করতে অ্যাকাউন্ট লাগে না। রিপোর্টকারীর নাম, ফোন বা ইমেইল
            চাওয়া হয় না; অ্যাপের ডেটাবেসে IP ঠিকানাও রাখা হয় না।
          </p>
          <div className="story-privacy-facts">
            <div>
              <h3>শুধু পর্যালোচকের কাছে</h3>
              <p>
                প্রমাণের ফাইল এবং আলাদা ঘরে দেওয়া অভিযুক্তের নাম ও তথ্য সাধারণ
                দর্শকের কাছে সরাসরি প্রকাশিত হয় না।
              </p>
            </div>
            <div>
              <h3>জমা দেওয়ার আগে দেখুন</h3>
              <p>
                লেখা, ছবি, PDF বা অডিওতে পরিচয় থেকে যেতে পারে। অপ্রয়োজনীয় তথ্য সরিয়ে
                তারপর জমা দিন। হোস্টিং সেবার লগও আলাদাভাবে নিয়ন্ত্রণ করতে হয়।
              </p>
            </div>
          </div>
          <button className="story-text-link" onClick={onPrivacy}>
            গোপনীয়তা সম্পর্কে বিস্তারিত জানুন ↗
          </button>
        </div>
      </div>
    </section>
  );
}

export function PublicExpectations({ onReport }: { onReport: () => void }) {
  return (
    <section
      className="story-section story-expectations"
      id="expectations"
      aria-labelledby="expectations-title"
    >
      <div className="jwr-shell">
        <div className="story-heading story-reveal">
          <div>
            <span className="story-eyebrow">কী আশা করতে পারেন</span>
            <h2 id="expectations-title">
              তথ্য সামনে আসুক।
              <br />
              <span>বোঝাপড়া থেকে জবাবদিহি।</span>
            </h2>
          </div>
          <p>
            এই প্ল্যাটফর্মের কাজ অভিযোগ গ্রহণ, পর্যালোচনা ও প্রকাশযোগ্য তথ্য এক
            জায়গায় দেখানো। কী পাওয়া যাবে তা আগে থেকেই পরিষ্কার থাকা ভালো।
          </p>
        </div>
        <div className="story-expectation-grid">
          <article className="story-reveal">
            <span className="story-small-mark">↗</span>
            <h3>যা এখানে করতে পারবেন</h3>
            <ul>
              <li>পরিচয় না দিয়ে ঘটনার বিবরণ ও প্রমাণ জমা দিতে পারবেন।</li>
              <li>কোড দিয়ে নিজের রিপোর্টের অবস্থা দেখতে পারবেন।</li>
              <li>এলাকা ও ক্যাটাগরি অনুযায়ী প্রকাশিত অভিযোগ পড়তে পারবেন।</li>
            </ul>
          </article>
          <article className="story-reveal">
            <span className="story-small-mark">◇</span>
            <h3>যা মনে রাখা প্রয়োজন</h3>
            <ul>
              <li>
                প্রকাশিত তথ্য জনসাধারণের জমা দেওয়া অভিযোগ; অপরাধের চূড়ান্ত
                প্রমাণ নয়।
              </li>
              <li>
                রিপোর্ট জমা দেওয়া স্বয়ংক্রিয়ভাবে আনুষ্ঠানিক মামলা দায়ের করে না।
              </li>
              <li>
                প্রকাশ, নিষ্পত্তি বা নির্দিষ্ট সময়ের মধ্যে ফলাফলের নিশ্চয়তা
                দেওয়া হয় না।
              </li>
            </ul>
          </article>
        </div>
        <div className="story-invitation story-reveal">
          <p>
            ঘটনা সম্পর্কে নির্দিষ্ট তথ্য আছে?
            <br />
            <strong>আপনার জানা কথাটি গুছিয়ে জানান।</strong>
          </p>
          <button className="jwr-button" onClick={onReport}>
            ঘটনা রিপোর্ট করুন →
          </button>
        </div>
      </div>
    </section>
  );
}
