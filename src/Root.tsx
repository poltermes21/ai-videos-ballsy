import "./index.css";
import { Composition } from "remotion";
import { Ballsy } from "./ballsy";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Ballsy"
        component={Ballsy}
        durationInFrames={120}
        fps={30}
        width={1080}
        height={1080}
      />
    </>
  );
};