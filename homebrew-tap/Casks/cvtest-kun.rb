cask "cvtest-kun" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000",
         intel: "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/mochitablog0326-lgtm/cvtest-kun/releases/download/v#{version}/CVTestKun-#{version}-#{arch}.dmg"
  name "CVテスト君"
  name "CV Test Kun"
  desc "Automated CV (conversion) form testing tool for Japanese websites"
  homepage "https://github.com/mochitablog0326-lgtm/cvtest-kun"

  depends_on macos: ">= :big_sur"

  app "CVTestKun.app"

  zap trash: [
    "~/Library/Application Support/cvtest-kun",
    "~/Library/Preferences/com.github.mochitablog0326.cvtestkun.plist",
    "~/Library/Saved Application State/com.github.mochitablog0326.cvtestkun.savedState",
  ]
end
