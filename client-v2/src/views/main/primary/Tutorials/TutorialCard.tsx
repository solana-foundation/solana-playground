import { FC } from "react";
import styled, { css, keyframes } from "styled-components";

import Card from "../../../../components/Card";
import Img from "../../../../components/Img";
import { DetailTag } from "@/entities/tutorial";
import { PgTheme, PgTutorial, TutorialFullData } from "../../../../utils";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

type TutorialCardProps = TutorialFullData;

const TutorialCard: FC<React.PropsWithChildren<TutorialCardProps>> = ({
  name,
  description,
  thumbnail,
  level,
  framework,
  pageCount,
  metadata,
}) => (
  <Wrapper
    onClick={() =>
      PgTutorial.open(name).catch(reportButtonFailure("open the tutorial"))
    }
  >
    <ImgWrapper
      progress={
        metadata
          ? metadata.completed
            ? 100
            : ((metadata.pageNumber - 1) / pageCount) * 100
          : 0
      }
    >
      <TutorialImg src={thumbnail} />
    </ImgWrapper>

    <InfoWrapper>
      <InfoTopWrapper>
        <NameRow>
          <Name>{name}</Name>
          <DetailTag kind="level" value={level} />
        </NameRow>
        <Description>{description}</Description>
      </InfoTopWrapper>

      <InfoBottomWrapper>
        {framework && (
          <DetailTag kind="framework" value={framework} className="mt-3" />
        )}
      </InfoBottomWrapper>
    </InfoWrapper>
  </Wrapper>
);

const Wrapper = styled(Card)`
  padding: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const ImgWrapper = styled.div<{ progress: number }>`
  ${({ theme, progress }) => css`
    width: 100%;
    position: relative;

    &::after {
      content: "";
      position: absolute;
      left: 0;
      bottom: 0;
      height: 0.25rem;
      background: ${progress === 100
        ? `linear-gradient(90deg, ${
            theme.colors.state.success.color
          } 0%, ${PgTheme.alpha(
            theme.colors.state.success.color,
            "high"
          )} 100%)`
        : `linear-gradient(90deg, ${theme.colors.default.primary} 0%, ${theme.colors.default.secondary} 100%)`};
      animation: ${keyframes`from { width: 0; } to { width: ${progress}%; }`}
        ${theme.default.transition.duration.long}
        ${theme.default.transition.type} forwards;
    }
  `}
`;

const TutorialImg = styled(Img)`
  aspect-ratio: 4 / 3;
  width: 100%;
  object-fit: cover;
`;

const InfoWrapper = styled.div`
  width: 100%;
  flex: 1;
  padding: 1rem 0.75rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
`;

const InfoTopWrapper = styled.div``;

const NameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Name = styled.span`
  font-weight: bold;
  ${PgTheme.getClampLinesCSS(1)};
`;

const Description = styled.div`
  ${({ theme }) => css`
    margin-top: 0.75rem;
    color: ${theme.colors.default.textSecondary};
    ${PgTheme.getClampLinesCSS(2)};
  `}
`;

const InfoBottomWrapper = styled.div``;

export default TutorialCard;
