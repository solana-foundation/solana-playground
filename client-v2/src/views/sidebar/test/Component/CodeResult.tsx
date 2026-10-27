import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/shared/ui/code-block";
import { CopyButton } from "@/shared/ui/copy-button";

interface CodeResultProps {
  children: string;
}

/** A fetched account or received events, as JSON the user can copy whole */
const CodeResult = ({ children }: CodeResultProps) => (
  <CodeBlock>
    <CodeBlockHeader>
      <CodeBlockTitle>JSON</CodeBlockTitle>
      <CodeBlockActions>
        <CopyButton
          value={children}
          onError={reportButtonFailure("copy the JSON")}
        />
      </CodeBlockActions>
    </CodeBlockHeader>
    <CodeBlockContent className="max-h-80 overflow-auto select-text">
      {children}
    </CodeBlockContent>
  </CodeBlock>
);

export default CodeResult;
