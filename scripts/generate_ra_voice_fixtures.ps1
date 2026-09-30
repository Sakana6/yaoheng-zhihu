param([string]$OutputDirectory = '.runtime-logs/ra-voice-fixtures')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$folder = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($folder) | Out-Null
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speaker.SelectVoice('Microsoft Huihui Desktop')
    $cases = @(
        @{id='medication';text='今天早上已经吃药了。';keywords=@('今天','吃药')},
        @{id='symptom';text='今天早餐吃得少，后来有点头晕。';keywords=@('早餐','少','头晕')},
        @{id='negative';text='我没有头晕，也没有吃药。';keywords=@('没有','头晕','吃药')},
        @{id='meal';text='今天没有吃早餐，中午吃了一碗饭。';keywords=@('没有','早餐','中午')},
        @{id='glucose';text='今天测量血糖是六点二。';keywords=@('血糖','6.2')},
        @{id='makeup';text='昨天晚上忘记吃药，今天早上补吃了一次。';keywords=@('昨天','忘记','今天')},
        @{id='other';text='不是我，是家人出现了头晕。';keywords=@('不是我','家人','头晕')},
        @{id='pressure';text='今天测量血压，收缩压一百二十，舒张压八十。';keywords=@('血压','120','80')}
    )
    foreach($case in $cases){
        $speaker.SetOutputToWaveFile((Join-Path $folder ($case.id + '.wav')))
        $speaker.Speak($case.text)
        $speaker.SetOutputToNull()
    }
    $cases | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $folder 'manifest.json')
} finally { $speaker.Dispose() }
