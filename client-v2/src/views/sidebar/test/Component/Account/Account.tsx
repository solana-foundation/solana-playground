import { FC, useState } from "react";

import CodeResult from "../CodeResult";
import InputLabel from "../InputLabel";
import Interaction from "../Interaction";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import SearchBar from "../../../../../components/SearchBar";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { SpinnerWithBg } from "../../../../../components/Loading";
import { PgCommon, PgWeb3 } from "../../../../../utils";
import { PgProgramInteraction } from "../../../../../utils/program-interaction";
import { useWallet } from "../../../../../hooks";
import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

interface AccountProps {
  accountName: string;
}

const Account: FC<React.PropsWithChildren<AccountProps>> = ({
  accountName,
}) => {
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState(false);
  const [fetchedData, setFetchedData] = useState<object>();
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchOneLoading, setFetchOneLoading] = useState(false);
  const [fetchAllLoading, setFetchAllLoading] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);

  const wallet = useWallet();

  const createFetch = (
    cb: () => Promise<NonNullable<typeof fetchedData>>,
    setLoading: typeof setFetchOneLoading
  ) => {
    return async () => {
      setLoading(true);
      try {
        const data = await PgCommon.transition(cb());
        setFetchedData(data);
        setFetchError(null);
      } catch (e: any) {
        if (e.message.startsWith("Account does not exist")) {
          setFetchError("Account does not exist");
        } else if (e.message === "Invalid account discriminator") {
          setFetchError(`Given account is not type ${accountName}`);
        } else {
          setFetchError(`Unknown error: ${e.message}`);
        }
      } finally {
        setLoading(false);
        setResultOpen(true);
      }
    };
  };

  const fetchOne = createFetch(() => {
    return PgProgramInteraction.fetchAccount(
      accountName,
      new PgWeb3.PublicKey(address)
    );
  }, setFetchOneLoading);

  const fetchAll = createFetch(
    () => PgProgramInteraction.fetchAllAccounts(accountName),
    setFetchAllLoading
  );

  return (
    <Interaction name={accountName}>
      <div className="my-2">
        <InputLabel name="address" type="publicKey" />
        <SearchBar
          value={address}
          onChange={(ev) => setAddress(ev.target.value)}
          error={addressError}
          setError={setAddressError}
          validator={PgCommon.isPk}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <AsyncButton
          variant="outline"
          onClick={fetchOne}
          onError={reportButtonFailure("fetch the account")}
          disabled={!wallet || fetchAllLoading || !address || addressError}
        >
          Fetch
        </AsyncButton>
        <AsyncButton
          variant="outline"
          onClick={fetchAll}
          onError={reportButtonFailure("fetch the accounts")}
          disabled={!wallet || fetchOneLoading}
        >
          Fetch All
        </AsyncButton>
      </div>

      {(fetchedData || fetchError) && (
        <div className="mt-4 w-full">
          <Collapsible open={resultOpen} onOpenChange={setResultOpen}>
            <CollapsibleHeading>
              <CollapsibleChevron />
              Result
            </CollapsibleHeading>
            <CollapsibleContent className="mt-2">
              <SpinnerWithBg loading={fetchOneLoading || fetchAllLoading}>
                {fetchError ? (
                  <Callout variant="error">
                    <CalloutDescription>{fetchError}</CalloutDescription>
                  </Callout>
                ) : (
                  <CodeResult>{PgCommon.prettyJSON(fetchedData!)}</CodeResult>
                )}
              </SpinnerWithBg>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </Interaction>
  );
};

export default Account;
