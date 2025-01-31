# 1️⃣ Install kokoro
# !pip install -q kokoro>=0.3.1 soundfile
# 2️⃣ Install espeak, used for English OOD fallback and some non-English languages
# !apt-get -qq -y install espeak-ng > /dev/null 2>&1
# 🇪🇸 'e' => Spanish es
# 🇫🇷 'f' => French fr-fr
# 🇮🇳 'h' => Hindi hi
# 🇮🇹 'i' => Italian it
# 🇧🇷 'p' => Brazilian Portuguese pt-br

# 3️⃣ Initalize a pipeline
from kokoro import KPipeline
from IPython.display import display, Audio
import soundfile as sf
# 🇺🇸 'a' => American English, 🇬🇧 'b' => British English
# 🇯🇵 'j' => Japanese: pip install misaki[ja]
# 🇨🇳 'z' => Mandarin Chinese: pip install misaki[zh]
pipeline = KPipeline(lang_code='z') # <= make sure lang_code matches voice

# This text is for demonstration purposes only, unseen during training
#text = """In the relentless dance of survival, where each breath was a battle, Amelia toiled tirelessly. Days blurred into nights, a relentless cycle of obligations and struggles. But amidst the chaos, a flicker of something stirred.

# One evening, as she sat exhausted on her couch, a wise old woman appeared on her TV screen. "Remember, dear," the woman whispered softly, "to live while you are busy surviving."

# Amelia's heart skipped a beat. Had she forgotten how to experience joy in the face of adversity? She looked around her tiny apartment, her eyes falling on a forgotten book on her shelf. With trembling hands, she picked it up and began to read.

# As she delved into the pages, words of hope and inspiration filled her. She realized that even in the most trying times, life held its precious moments. A stolen smile, a warm embrace, the beauty of a sunset – these were the fragments of living that made the journey worthwhile.

# From that day forward, Amelia made a conscious effort to seek out those moments of joy. She found laughter in unexpected places, gratitude in the simplest of gestures. And as she remembered to live, the weight of survival grew lighter, replaced by a newfound sense of fulfillment."""

# text = '「もしおれがただ偶然、そしてこうしようというつもりでなくここに立っているのなら、ちょっとばかり絶望するところだな」と、そんなことが彼の頭に思い浮かんだ。'
text = '中國人民不信邪也不怕邪，不惹事也不怕事，任何外國不要指望我們會拿自己的核心利益做交易，不要指望我們會吞下損害我國主權、安全、發展利益的苦果！'
# text = 'Los partidos políticos tradicionales compiten con los populismos y los movimientos asamblearios.'
# text = 'Le dromadaire resplendissant déambulait tranquillement dans les méandres en mastiquant de petites feuilles vernissées.'
# text = 'ट्रांसपोर्टरों की हड़ताल लगातार पांचवें दिन जारी, दिसंबर से इलेक्ट्रॉनिक टोल कलेक्शनल सिस्टम'
# text = "Allora cominciava l'insonnia, o un dormiveglia peggiore dell'insonnia, che talvolta assumeva i caratteri dell'incubo."
# text = 'Elabora relatórios de acompanhamento cronológico para as diferentes unidades do Departamento que propõem contratos.'

# 4️⃣ Generate, display, and save audio files in a loop.
generator = pipeline(
    text, voice='af_heart', # <= change voice here
    speed=1, split_pattern=r'\n+'
)
for i, (gs, ps, audio) in enumerate(generator):
    print(i)  # i => index
    print(gs) # gs => graphemes/text
    print(ps) # ps => phonemes
    display(Audio(data=audio, rate=24000, autoplay=i==0))
    sf.write(f'{i}.wav', audio, 24000) # save each audio file
